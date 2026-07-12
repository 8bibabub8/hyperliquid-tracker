import { createClient } from 'npm:@supabase/supabase-js@2';

type SetWalletNotificationsBody = {
  pushToken?: string;
  address?: string;
  enabled?: boolean;
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
    const body = (await req.json()) as SetWalletNotificationsBody;

    const pushToken = body.pushToken?.trim();
    const address = body.address?.trim().toLowerCase();
    const enabled = body.enabled;

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

    if (typeof enabled !== 'boolean') {
      return new Response(
        JSON.stringify({ error: 'enabled must be a boolean' }),
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
      .select('id')
      .eq('push_token', pushToken)
      .single();

    if (deviceError || !device) {
      return new Response(
        JSON.stringify({
          error: 'Device not found for push token',
          details: deviceError,
        }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const { data: wallet, error: walletError } = await supabase
      .from('tracked_wallets')
      .update({
        notifications_enabled: enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('device_id', device.id)
      .eq('address', address)
      .select('id, address, notifications_enabled')
      .single();

    if (walletError || !wallet) {
      return new Response(
        JSON.stringify({
          error: 'Could not update wallet notifications',
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

    return new Response(
      JSON.stringify({
        ok: true,
        walletId: wallet.id,
        address: wallet.address,
        notificationsEnabled: wallet.notifications_enabled,
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
