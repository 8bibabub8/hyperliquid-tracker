import { createClient } from 'npm:@supabase/supabase-js@2';

type PositionState = {
  coin: string;
  side: 'Long' | 'Short';
  size: number;
  positionValue: number;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function normalizePositions(data: any): PositionState[] {
  const raw = data?.assetPositions ?? [];

  return raw.map((item: any) => {
    const p = item?.position ?? {};
    const size = Number(p?.szi ?? 0);

    const positionValue = Number(
      p?.positionValue ??
        p?.notionalUsd ??
        p?.notional ??
        0
    );

    return {
      coin: String(p?.coin ?? 'Unknown'),
      side: size >= 0 ? 'Long' : 'Short',
      size,
      positionValue,
    };
  });
}

function getAlertMessages(
  previous: PositionState[],
  current: PositionState[],
  minValue: number
) {
  const messages: string[] = [];

  const opened = current.filter(
    (p) =>
      !previous.some((x) => x.coin === p.coin) &&
      p.positionValue >= minValue
  );

  const closed = previous.filter(
    (p) =>
      !current.some((x) => x.coin === p.coin) &&
      p.positionValue >= minValue
  );

  const persisted = current.filter((p) =>
    previous.some((x) => x.coin === p.coin)
  );

  const increased = persisted.filter((currentPosition) => {
    const previousPosition = previous.find(
      (x) => x.coin === currentPosition.coin
    );

    if (!previousPosition) return false;

    return (
      Math.abs(currentPosition.size) > Math.abs(previousPosition.size) &&
      currentPosition.positionValue >= minValue
    );
  });

  const decreased = persisted.filter((currentPosition) => {
    const previousPosition = previous.find(
      (x) => x.coin === currentPosition.coin
    );

    if (!previousPosition) return false;

    return (
      Math.abs(currentPosition.size) < Math.abs(previousPosition.size) &&
      previousPosition.positionValue >= minValue
    );
  });

  opened.forEach((p) => {
    messages.push(`Opened ${p.coin} ${p.side}`);
  });

  closed.forEach((p) => {
    messages.push(`Closed ${p.coin}`);
  });

  increased.forEach((p) => {
    messages.push(`Increased ${p.coin}`);
  });

  decreased.forEach((p) => {
    messages.push(`Decreased ${p.coin}`);
  });

  return messages;
}

async function sendExpoPush(pushToken: string, body: string) {
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: pushToken,
      title: 'Wallet Alert',
      body,
      sound: 'default',
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('Expo push failed:', result);
  }

  return result;
}

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: wallets, error } = await supabase
      .from('tracked_wallets')
      .select(`
        id,
        address,
        name,
        min_alert_value,
        devices (
          push_token
        ),
        wallet_states (
          last_positions
        )
      `)
      .eq('is_active', true);

    if (error) {
      return new Response(
        JSON.stringify({ error: 'Could not load wallets', details: error }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let checked = 0;
    let pushed = 0;

    for (const wallet of wallets ?? []) {
      checked += 1;

      const pushToken = wallet.devices?.push_token;
      const previousPositions =
        wallet.wallet_states?.last_positions ?? [];

      if (!pushToken) continue;

      const hyperResponse = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'clearinghouseState',
          user: wallet.address,
        }),
      });

      const hyperData = await hyperResponse.json();
      const currentPositions = normalizePositions(hyperData);

      const messages = getAlertMessages(
        previousPositions,
        currentPositions,
        Number(wallet.min_alert_value ?? 100)
      );

      for (const message of messages) {
        await sendExpoPush(pushToken, `${wallet.name || 'Wallet'}: ${message}`);
        pushed += 1;
      }

      await supabase
        .from('wallet_states')
        .upsert(
          {
            wallet_id: wallet.id,
            last_positions: currentPositions,
            last_account_value: Number(
              hyperData?.marginSummary?.accountValue ?? 0
            ),
            checked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: 'wallet_id',
          }
        );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        checked,
        pushed,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Unexpected error',
        details: String(error),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});