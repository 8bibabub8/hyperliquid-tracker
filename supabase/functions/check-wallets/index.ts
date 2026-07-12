import { createClient } from 'npm:@supabase/supabase-js@2';

type PositionState = {
  coin: string;
  side: 'Long' | 'Short';
  size: number;
  positionValue: number;
};

type FillState = {
  coin: string;
  side: string;
  size: number;
  price: number;
  usdValue: number;
  time: number;
  hash?: string;
  rawDir?: string;
};

type FillGroup = {
  coin: string;
  side: string;
  size: number;
  price: number;
  usdValue: number;
  time: number;
  count: number;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const MAX_PUSHES_PER_RUN = 5;
const FILL_LOOKBACK_MS = 10 * 60 * 1000;
const FILL_GROUP_WINDOW_MS = 5 * 60 * 1000;

function normalizePositions(data: any): PositionState[] {
  const raw = data?.assetPositions ?? [];

  return raw.map((item: any) => {
    const p = item?.position ?? {};
    const size = Number(p?.szi ?? 0);

    return {
      coin: String(p?.coin ?? 'Unknown'),
      side: size >= 0 ? 'Long' : 'Short',
      size,
      positionValue: Number(
        p?.positionValue ?? p?.notionalUsd ?? p?.notional ?? 0
      ),
    };
  });
}

function normalizeFills(data: any): FillState[] {
  const raw = Array.isArray(data) ? data : [];

  return raw
    .map((fill: any) => {
      const coin = String(fill?.coin ?? 'Unknown');
      const size = Math.abs(Number(fill?.sz ?? 0));
      const price = Number(fill?.px ?? 0);
      const time = Number(fill?.time ?? 0);
      const rawDir = String(fill?.dir ?? '');
      const dirText = rawDir.toLowerCase();

      let side = 'TRADE';

      if (
        dirText.includes('close short') ||
        dirText.includes('buy') ||
        dirText.includes('open long')
      ) {
        side = 'BUY';
      } else if (
        dirText.includes('close long') ||
        dirText.includes('sell') ||
        dirText.includes('open short')
      ) {
        side = 'SELL';
      }

      return {
        coin,
        side,
        size,
        price,
        usdValue: size * price,
        time,
        hash: fill?.hash ? String(fill.hash) : undefined,
        rawDir,
      };
    })
    .filter((fill) => fill.time > 0 && fill.size > 0 && fill.price > 0)
    .sort((a, b) => a.time - b.time);
}

function makeFillKey(walletAddress: string, fill: FillState) {
  // Fixed-precision floats prevent key mismatches from float representation quirks
  return [
    walletAddress.toLowerCase(),
    fill.time,
    fill.coin,
    fill.side,
    fill.size.toFixed(8),
    fill.price.toFixed(8),
    fill.hash ?? '',
  ].join('|');
}

function formatUsd(value: number) {
  return Math.round(value).toLocaleString('en-US');
}

function formatSize(value: number) {
  return value >= 1
    ? value.toFixed(4).replace(/\.?0+$/, '')
    : value.toPrecision(4);
}

function formatTime(timestampMs: number): string {
  const d = new Date(timestampMs);
  const h = d.getUTCHours().toString().padStart(2, '0');
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function formatFillMessage(
  fill: { coin: string; side: string; size: number; price: number; usdValue: number; time: number },
  count = 1
) {
  const priceText =
    fill.price >= 100 ? fill.price.toFixed(2) : fill.price.toPrecision(4);

  const countSuffix = count > 1 ? ` • ${count}x` : '';

  const coinLabel = fill.coin.replace(/^[^:]*:/, '');

  return `${fill.side} ${formatSize(fill.size)} ${coinLabel} @ $${priceText} • $${formatUsd(fill.usdValue)}${countSuffix} • ${formatTime(fill.time)}`;
}

function groupFillsForPush(fills: FillState[]): FillGroup[] {
  const groups: FillGroup[] = [];

  for (const fill of fills) {
    const last = groups[groups.length - 1];

    if (
      last &&
      last.coin === fill.coin &&
      last.side === fill.side &&
      fill.time - last.time <= FILL_GROUP_WINDOW_MS
    ) {
      const totalSize = last.size + fill.size;

      last.price =
        totalSize > 0
          ? (last.price * last.size + fill.price * fill.size) / totalSize
          : fill.price;
      last.size = totalSize;
      last.usdValue += fill.usdValue;
      last.time = fill.time;
      last.count += 1;
    } else {
      groups.push({
        coin: fill.coin,
        side: fill.side,
        size: fill.size,
        price: fill.price,
        usdValue: fill.usdValue,
        time: fill.time,
        count: 1,
      });
    }
  }

  return groups;
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

  console.log('Expo push response:', JSON.stringify(result));

  if (!response.ok) {
    console.error('Expo push failed:', JSON.stringify(result));
  }

  return result;
}

// Returns the set of fill_keys that were actually newly inserted into the DB.
// Fills already present (duplicate key) are silently ignored and NOT returned.
// Requires a UNIQUE constraint on processed_fills.fill_key for atomic deduplication.
async function markFillsAsProcessed(
  supabase: any,
  walletAddress: string,
  fills: FillState[]
): Promise<Set<string>> {
  if (fills.length === 0) return new Set();

  const records = fills.map((fill) => ({
    fill_key: makeFillKey(walletAddress, fill),
    wallet_address: walletAddress,
    coin: fill.coin,
    side: fill.side,
    fill_time: fill.time,
    usd_value: fill.usdValue,
  }));

  const { data, error } = await supabase
    .from('processed_fills')
    .upsert(records, { onConflict: 'fill_key', ignoreDuplicates: true })
    .select('fill_key');

  if (error) {
    console.error('markFillsAsProcessed error:', JSON.stringify(error));
    return new Set();
  }

  // Only rows actually inserted are returned (conflicts are excluded)
  return new Set((data ?? []).map((row: any) => row.fill_key));
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
        notifications_enabled,
        devices (
          push_token
        ),
        wallet_states (
          last_positions,
          last_fill_time
        )
      `)
      .eq('is_active', true);

    if (error) {
      console.error('Could not load wallets:', JSON.stringify(error));

      return new Response(
        JSON.stringify({ error: 'Could not load wallets', details: error }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let checked = 0;
    let detected = 0;
    let pushed = 0;

    console.log('Function started');
    console.log('Wallets loaded:', wallets?.length ?? 0);

    for (const wallet of wallets ?? []) {
      checked += 1;

      const pushToken = Array.isArray(wallet.devices)
        ? wallet.devices[0]?.push_token
        : wallet.devices?.push_token;

      if (!pushToken) {
        console.log('No push token for wallet:', wallet.address);
        continue;
      }

      const hyperStateResponse = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'clearinghouseState',
          user: wallet.address,
        }),
      });

      const hyperFillsResponse = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'userFills',
          user: wallet.address,
          aggregateByTime: false,
        }),
      });

      if (!hyperStateResponse.ok || !hyperFillsResponse.ok) {
        console.error('Hyperliquid request failed:', wallet.address);
        continue;
      }

      const hyperStateData = await hyperStateResponse.json();
      const hyperFillsData = await hyperFillsResponse.json();

      const currentPositions = normalizePositions(hyperStateData);
      const fills = normalizeFills(hyperFillsData);

      const minAlertValue = Number(wallet.min_alert_value ?? 100);
      const recentCutoff = Date.now() - FILL_LOOKBACK_MS;

      const candidateFills = fills.filter(
        (fill) => fill.time >= recentCutoff && fill.usdValue >= minAlertValue
      );

      // Existence check only: we just need to know whether this wallet has any
      // processed fills yet — never the exact count. LIMIT 1 stops at the first
      // matching row (index scan on wallet_address) instead of a full count.
      const { data: existingFills } = await supabase
        .from('processed_fills')
        .select('id')
        .eq('wallet_address', wallet.address)
        .limit(1);

      if ((existingFills?.length ?? 0) === 0) {
        console.log('Initialising processed fills for wallet:', wallet.address);
        console.log('Initial fills marked without push:', candidateFills.length);

        await markFillsAsProcessed(supabase, wallet.address, candidateFills);

        await supabase.from('wallet_states').upsert(
          {
            wallet_id: wallet.id,
            last_positions: currentPositions,
            last_account_value: Number(
              hyperStateData?.marginSummary?.accountValue ?? 0
            ),
            last_fill_time:
              fills.length > 0
                ? Math.max(...fills.map((fill) => fill.time))
                : null,
            checked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'wallet_id' }
        );

        continue;
      }

      // Mark candidate fills as processed BEFORE pushing.
      // The DB unique constraint on fill_key ensures only the first concurrent caller
      // wins the insert — the returned set contains only truly new fills.
      const newlyMarkedKeys = await markFillsAsProcessed(
        supabase,
        wallet.address,
        candidateFills
      );

      const newFills = candidateFills.filter((fill) =>
        newlyMarkedKeys.has(makeFillKey(wallet.address, fill))
      );

      console.log(
        `Candidates: ${candidateFills.length}, truly new: ${newFills.length}`
      );

      const fillGroups = groupFillsForPush(newFills);
      const groupsToPush = fillGroups.slice(-MAX_PUSHES_PER_RUN);

      if (fillGroups.length > MAX_PUSHES_PER_RUN) {
        console.log(
          `Push safety limit: ${fillGroups.length} fill groups found, only ${MAX_PUSHES_PER_RUN} will be pushed.`
        );
      }

      for (const group of groupsToPush) {
        const message = formatFillMessage(group, group.count);

        await supabase.from('alert_events').insert({
          wallet_address: wallet.address,
          wallet_name: wallet.name,
          coin: group.coin,
          alert_type: 'fill',
          previous_side: null,
          current_side: group.side,
          previous_size: null,
          current_size: group.size,
          previous_value: null,
          current_value: group.usdValue,
          message,
        });

        const pushBody = `${wallet.name || 'Wallet'}: ${message}`;

        detected += 1;

        // Per-wallet mute: ingestion, fill_key dedup and all DB writes above run
        // unchanged so Recent Fills stays complete — only the push send is skipped.
        if (wallet.notifications_enabled === false) {
          console.log('Notifications muted, skipping push for wallet:', wallet.address);
          continue;
        }

        console.log('Sending push:', pushBody);

        await sendExpoPush(pushToken, pushBody);

        pushed += 1;
      }

      await supabase.from('wallet_states').upsert(
        {
          wallet_id: wallet.id,
          last_positions: currentPositions,
          last_account_value: Number(
            hyperStateData?.marginSummary?.accountValue ?? 0
          ),
          last_fill_time:
            fills.length > 0
              ? Math.max(...fills.map((fill) => fill.time))
              : null,
          checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'wallet_id' }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        checked,
        detected,
        pushed,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Unexpected error:', String(error));

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
