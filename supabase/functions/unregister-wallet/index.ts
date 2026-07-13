import { createClient } from 'npm:@supabase/supabase-js@2';

type UnregisterWalletBody = {
  pushToken?: string;
  address?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const body = (await req.json()) as UnregisterWalletBody;

    const pushToken = body.pushToken?.trim();
    const address = body.address?.trim().toLowerCase();

    if (!pushToken) {
      return jsonResponse({ error: 'pushToken is required' }, 400);
    }

    if (!address) {
      return jsonResponse({ error: 'Address is required' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Identify the calling device. Unknown device => it never registered
    // this wallet, but we still run the orphan cleanup below.
    const { data: device, error: deviceError } = await supabase
      .from('devices')
      .select('id')
      .eq('push_token', pushToken)
      .maybeSingle();

    if (deviceError) {
      return jsonResponse(
        { error: 'Could not look up device', details: deviceError },
        500
      );
    }

    if (device) {
      const { data: walletRows, error: walletLookupError } = await supabase
        .from('tracked_wallets')
        .select('id')
        .eq('device_id', device.id)
        .eq('address', address);

      if (walletLookupError) {
        return jsonResponse(
          {
            error: 'Could not look up tracked wallet',
            details: walletLookupError,
          },
          500
        );
      }

      const walletIds = (walletRows ?? []).map((row) => row.id);

      if (walletIds.length > 0) {
        // Children first: wallet_states.wallet_id references
        // tracked_wallets.id without ON DELETE CASCADE.
        const { error: stateError } = await supabase
          .from('wallet_states')
          .delete()
          .in('wallet_id', walletIds);

        if (stateError) {
          return jsonResponse(
            { error: 'Could not delete wallet state', details: stateError },
            500
          );
        }

        const { error: walletError } = await supabase
          .from('tracked_wallets')
          .delete()
          .in('id', walletIds);

        if (walletError) {
          return jsonResponse(
            { error: 'Could not delete tracked wallet', details: walletError },
            500
          );
        }
      }
    }

    // Address-keyed data is shared across devices: only delete it once no
    // tracked_wallets row (any device) still references this address. This
    // runs even when this device's row was already gone, so a retry after a
    // partial failure still cleans up orphaned rows.
    const { data: remaining, error: remainingError } = await supabase
      .from('tracked_wallets')
      .select('id')
      .eq('address', address)
      .limit(1);

    if (remainingError) {
      return jsonResponse(
        {
          error: 'Could not check remaining trackers',
          details: remainingError,
        },
        500
      );
    }

    let addressDataDeleted = false;

    if ((remaining?.length ?? 0) === 0) {
      const { error: fillsError } = await supabase
        .from('processed_fills')
        .delete()
        .eq('wallet_address', address);

      if (fillsError) {
        return jsonResponse(
          { error: 'Could not delete processed fills', details: fillsError },
          500
        );
      }

      const { error: eventsError } = await supabase
        .from('alert_events')
        .delete()
        .eq('wallet_address', address);

      if (eventsError) {
        return jsonResponse(
          { error: 'Could not delete alert events', details: eventsError },
          500
        );
      }

      addressDataDeleted = true;
    }

    return jsonResponse({ ok: true, address, addressDataDeleted }, 200);
  } catch (error) {
    return jsonResponse(
      { error: 'Unexpected error', details: String(error) },
      500
    );
  }
});
