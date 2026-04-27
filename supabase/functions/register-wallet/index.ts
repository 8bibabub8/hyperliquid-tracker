import { createClient } from 'npm:@supabase/supabase-js@2';

type RegisterWalletBody = {
  pushToken?: string;
  address?: string;
  name?: string;
  platform?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  try {
    const body = (await req.json()) as RegisterWalletBody;

    const pushToken = body.pushToken?.trim();
    const address = body.address?.trim().toLowerCase();
    const name = body.name?.trim() || 'Wallet';
    const platform = body.platform?.trim() || 'unknown';

    if (!pushToken) {
      return new Response(
        JSON.stringify({ error: 'pushToken is required' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    if (!address || !address.startsWith('0x') || address.length < 20) {
      return new Response(
        JSON.stringify({ error: 'Valid wallet address is required' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: device, error: deviceError } = await supabase
      .from('devices')
      .upsert(
        {
          push_token: pushToken,
          platform,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'push_token',
        }
      )
      .select('id')
      .single();

    if (deviceError || !device) {
      return new Response(
        JSON.stringify({
          error: 'Could not create or update device',
          details: deviceError,
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const { data: wallet, error: walletError } = await supabase
      .from('tracked_wallets')
      .upsert(
        {
          device_id: device.id,
          address,
          name,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'device_id,address',
        }
      )
      .select('id, address, name')
      .single();

    if (walletError || !wallet) {
      return new Response(
        JSON.stringify({
          error: 'Could not create or update tracked wallet',
          details: walletError,
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const { error: stateError } = await supabase
      .from('wallet_states')
      .upsert(
        {
          wallet_id: wallet.id,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'wallet_id',
        }
      );

    if (stateError) {
      return new Response(
        JSON.stringify({
          error: 'Could not create wallet state',
          details: stateError,
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        deviceId: device.id,
        walletId: wallet.id,
        address: wallet.address,
        name: wallet.name,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
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
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});