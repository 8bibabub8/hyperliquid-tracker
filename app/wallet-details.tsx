import { darkTheme, lightTheme } from '../theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const SUPABASE_FUNCTIONS_URL = 'https://cvdnudenzjooginvgbnt.supabase.co/functions/v1';

// Local-only cache of the per-wallet notification preference, keyed by address.
// It seeds the switch on mount; the database row (written via the edge function)
// remains the source of truth that check-wallets reads.
const NOTIFICATIONS_STORAGE_PREFIX = 'wallet_notifications_';

async function getExpoPushToken() {
  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;

    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }

    if (status !== 'granted') {
      return null;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    if (!projectId) {
      return null;
    }

    const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
    return tokenResult.data;
  } catch (error) {
    console.log('Push token error:', error);
    return null;
  }
}

type PositionItem = {
  id: string;
  coin: string;
  size: string;
  entryPx: string;
  currentPx: string;
  leverage: string;
  unrealizedPnl: string;
  roe: string;
  side: 'Long' | 'Short';
  positionValue: string;
  liquidationPx: string;
  fundingRate: string;
};

type WalletDetails = {
  accountValue: string;
  positions: number;
  totalUnrealizedPnl: string;
  positionList: PositionItem[];
};

type TradeItem = {
  coin: string;
  side: string;
  px: string;
  sz: string;
  time: number;
  pnl?: string;
  dir?: string;
};

const deText = {
  perpsEquity: 'Perps Equity',
  perpsOnly: 'Nur Perpetuals / Margin-Konto',
  unrealizedPnl: 'Unrealized PnL',
  positions: 'Positionen',
  positionValue: 'Positionswert',
  noOpenPositions: 'Keine offenen Positionen.',
  size: 'Größe',
  entryPrice: 'Einstiegspreis',
  liquidationPrice: 'Liquidationspreis',
  fundingRate: 'Funding Rate',
  tapForDetails: 'Für Details tippen',
  tapToCollapse: 'Einklappen',
  tradeHistory: 'Letzte Ausführungen',
  noTradesFound: 'Keine Trades gefunden.',
  copied: '✓ Kopiert',
  fills: 'Fills',
  fillOpened: 'Eröffnet',
  fillClosed: 'Geschlossen',
  noData: 'Keine Daten',
  loadError: 'Wallet-Daten konnten nicht geladen werden.',
  invalidData: 'Hyperliquid hat ungültige Daten zurückgegeben.',
  marketError: 'Marktdaten konnten nicht geladen werden.',
  notifications: 'Benachrichtigungen',
  notificationsError: 'Benachrichtigungseinstellung konnte nicht gespeichert werden.',
  spot: 'Spot',
};

const enText: typeof deText = {
  perpsEquity: 'Perps Equity',
  perpsOnly: 'Perpetuals / margin account only',
  unrealizedPnl: 'Unrealized PnL',
  positions: 'Positions',
  positionValue: 'Position Value',
  noOpenPositions: 'No open positions.',
  size: 'Size',
  entryPrice: 'Entry Price',
  liquidationPrice: 'Liquidation Price',
  fundingRate: 'Funding Rate',
  tapForDetails: 'Tap for more details',
  tapToCollapse: 'Tap to collapse',
  tradeHistory: 'Recent Fills',
  noTradesFound: 'No trades found.',
  copied: '✓ Copied',
  fills: 'fills',
  fillOpened: 'Opened',
  fillClosed: 'Closed',
  noData: 'No data',
  loadError: 'Could not load wallet data.',
  invalidData: 'Hyperliquid returned invalid data.',
  marketError: 'Market data could not be loaded.',
  notifications: 'Notifications',
  notificationsError: 'Could not save notification setting.',
  spot: 'Spot',
};

function getAppText() {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
  return locale.startsWith('de') ? deText : enText;
}

function shortenAddress(address: string) {
  if (!address) return '';
  if (address.length < 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

function formatUSD(value: string | number) {
  const num = Number(value);
  if (isNaN(num)) return '$0.00';
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSignedUSD(value: string | number) {
  const num = Number(value);
  if (isNaN(num)) return '$0.00';
  const sign = num >= 0 ? '+' : '-';
  return sign + '$' + Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumber(value: string | number) {
  const num = Number(value);
  if (isNaN(num)) return '0';
  return num.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function formatTradeTime(time: number) {
  const d = new Date(time);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getSideLabel(side: string) {
  const s = side.toUpperCase();
  if (s.includes('B') || s.includes('BUY') || s.includes('LONG')) return 'BUY';
  return 'SELL';
}

function isBuySide(side: string) {
  return getSideLabel(side) === 'BUY';
}

// Display-only: trennt einen optionalen "dex:"-Präfix vom Symbol ab.
// "xyz:BTC" -> { dex: 'xyz', symbol: 'BTC' }; "BTC" -> { dex: null, symbol: 'BTC' };
// "#1890" / "@1890" werden als numerische ID erkannt (isId) und bleiben unverändert.
function parseFillCoin(raw: string) {
  const idx = raw.indexOf(':');
  const dex = idx > 0 ? raw.slice(0, idx) : null;
  const symbol = idx >= 0 ? raw.slice(idx + 1) : raw;
  const isId = /^[#@]?\d+$/.test(symbol.trim());
  return { dex, symbol, isId };
}

// Display-only: maps a Hyperliquid spot pair coin ("@N") to its base token name
// (e.g. "@230" -> "USDH"). spotMeta is fetched once and cached for the session;
// on failure the map stays empty and callers fall back to the raw coin.
let spotNameCache: Record<string, string> | null = null;

async function getSpotNameMap(): Promise<Record<string, string>> {
  if (spotNameCache) return spotNameCache;

  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'spotMeta' }),
    });
    const meta = JSON.parse(await res.text());

    const tokenNameByIndex: Record<number, string> = {};
    for (const token of meta?.tokens ?? []) {
      tokenNameByIndex[token?.index] = String(token?.name);
    }

    const map: Record<string, string> = {};
    for (const pair of meta?.universe ?? []) {
      const baseName = tokenNameByIndex[pair?.tokens?.[0]];
      if (pair?.name && baseName) map[String(pair.name)] = baseName;
    }

    spotNameCache = map;
    return map;
  } catch (error) {
    // Don't cache the failure so a later refresh can retry.
    console.log('Hyperliquid spotMeta request failed:', error);
    return {};
  }
}

// Display-only: leitet aus dem dir-Feld ab, ob ein Fill eine Position öffnet/schließt.
function getFillKind(dir?: string): 'open' | 'close' | null {
  const d = (dir ?? '').toLowerCase();
  if (d.includes('open')) return 'open';
  if (d.includes('close')) return 'close';
  return null;
}

function buildWalletDetails(data: any, dexData?: any): WalletDetails {
  // HIP-3 positions live on a separate clearinghouse (dex "xyz"); merge both
  // position arrays so they render together.
  const raw = [
    ...(data?.assetPositions ?? []),
    ...(dexData?.assetPositions ?? []),
  ];

  const positionList: PositionItem[] = raw.map((item: any) => {
    const p = item?.position ?? {};
    const size = Number(p?.szi ?? 0);
    const positionValue = Number(p?.positionValue ?? p?.notionalUsd ?? p?.notional ?? 0);
    const marginUsed = Number(p?.marginUsed ?? p?.initialMargin ?? 0);

    let leverage = '—';
    if (marginUsed > 0) {
      leverage = `${parseFloat((positionValue / marginUsed).toFixed(1))}x`;
    }

    // ROE is the return on the margin committed at entry. `marginUsed` is the
    // margin on the *current* (shrunken) notional, which overstates ROE for
    // underwater positions. Scale it back to the entry notional so the figure
    // reflects the actual capital deployed.
    let roe = '—';
    const unrealizedPnl = Number(p?.unrealizedPnl ?? 0);
    const entryNotional = Math.abs(size) * Number(p?.entryPx ?? 0);
    const entryMargin =
      positionValue > 0 ? (marginUsed * entryNotional) / positionValue : marginUsed;
    if (entryMargin > 0) {
      const roeValue = (unrealizedPnl / entryMargin) * 100;
      roe = `${roeValue.toFixed(1)}%`;
    }

    return {
      id: `${String(p?.coin ?? 'Unknown')}_${String(p?.entryPx ?? '0')}_${String(p?.szi ?? '0')}_${size >= 0 ? 'Long' : 'Short'}`,
      coin: String(p?.coin ?? 'Unknown'),
      size: String(p?.szi ?? '0'),
      entryPx: String(p?.entryPx ?? '0'),
      currentPx: '0',
      leverage,
      unrealizedPnl: String(p?.unrealizedPnl ?? '0'),
      roe,
      side: size >= 0 ? 'Long' : 'Short',
      positionValue: String(positionValue),
      liquidationPx: String(p?.liquidationPx ?? p?.liqPx ?? p?.liquidationPrice ?? '—'),
      fundingRate: '0',
    };
  });

  const totalUnrealizedPnl = positionList.reduce((sum, p) => sum + Number(p.unrealizedPnl || 0), 0);

  // Perps Equity spans both clearinghouses, so sum both account values.
  const accountValue =
    Number(data?.marginSummary?.accountValue ?? 0) +
    Number(dexData?.marginSummary?.accountValue ?? 0);

  return {
    accountValue: String(accountValue),
    positions: positionList.length,
    totalUnrealizedPnl: String(totalUnrealizedPnl),
    positionList,
  };
}

function getPositionValue(position: PositionItem) {
  const explicit = Number(position.positionValue);
  if (!isNaN(explicit) && explicit > 0) return explicit;

  const sizeAbs = Math.abs(Number(position.size));
  const price = Number(position.currentPx) > 0 ? Number(position.currentPx) : Number(position.entryPx);
  if (isNaN(sizeAbs) || isNaN(price)) return 0;
  return sizeAbs * price;
}

function aggregateTrades(fills: TradeItem[]) {
  const grouped: (TradeItem & { count: number })[] = [];

  for (const fill of fills) {
    const last = grouped[grouped.length - 1];
    const sameCoin = last?.coin === fill.coin;
    const sameSide = last?.side === fill.side;
    const closeInTime = !!last && Math.abs(last.time - fill.time) < 5 * 60 * 1000;

    if (sameCoin && sameSide && closeInTime) {
      const oldSize = Number(last.sz);
      const newSize = Number(fill.sz);
      const oldPrice = Number(last.px);
      const newPrice = Number(fill.px);
      const totalSize = oldSize + newSize;

      last.sz = String(totalSize);
      if (totalSize > 0 && !isNaN(oldPrice) && !isNaN(newPrice)) {
        last.px = String((oldPrice * oldSize + newPrice * newSize) / totalSize);
      }
      last.time = fill.time;
      const oldPnl = Number(last.pnl ?? 0);
      const newPnl = Number(fill.pnl ?? 0);

      if (!isNaN(oldPnl) || !isNaN(newPnl)) {
        last.pnl = String((isNaN(oldPnl) ? 0 : oldPnl) + (isNaN(newPnl) ? 0 : newPnl));
      }
      last.count += 1;
    } else {
      grouped.push({ ...fill, count: 1 });
    }
  }

  return grouped;
}

export default function WalletDetailsScreen() {
  const params = useLocalSearchParams();

  const address = String(params.address || '');
  const walletName = typeof params.name === 'string' && params.name.trim() ? params.name : 'Wallet';
  const themeMode = String(params.themeMode || 'dark');
  const text = useMemo(() => getAppText(), []);
  const theme = themeMode === 'light' ? lightTheme : darkTheme;
  const styles = createStyles(theme);

  const [details, setDetails] = useState<WalletDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedPositions, setExpandedPositions] = useState<string[]>([]);
  const [tradeHistory, setTradeHistory] = useState<(TradeItem & { count: number })[]>([]);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'positions' | 'fills'>('positions');
  const [spotNames, setSpotNames] = useState<Record<string, string>>({});
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notificationsBusy, setNotificationsBusy] = useState(false);

  const notificationsStorageKey = `${NOTIFICATIONS_STORAGE_PREFIX}${address.toLowerCase()}`;

  useEffect(() => {
    if (!address) return;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(notificationsStorageKey);
        if (stored !== null) setNotificationsEnabled(stored === 'true');
      } catch (error) {
        console.log('Could not read notification preference:', error);
      }
    })();
  }, [notificationsStorageKey, address]);

  const toggleNotifications = async (next: boolean) => {
    if (notificationsBusy) return;

    const previous = notificationsEnabled;
    // Optimistic UI: flip immediately, then reconcile with the backend.
    setNotificationsEnabled(next);
    setNotificationsBusy(true);

    try {
      const pushToken = await getExpoPushToken();
      if (!pushToken) throw new Error('No push token available');

      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/set-wallet-notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pushToken, address, enabled: next }),
      });

      if (!res.ok) throw new Error(`set-wallet-notifications failed: ${res.status}`);

      await AsyncStorage.setItem(notificationsStorageKey, String(next));
    } catch (error) {
      console.log('Could not update notifications:', error);
      // Rollback the optimistic change.
      setNotificationsEnabled(previous);
      Alert.alert('Error', text.notificationsError);
    } finally {
      setNotificationsBusy(false);
    }
  };

  const toggleExpanded = (positionId: string) => {
    setExpandedPositions((prev) =>
      prev.includes(positionId) ? prev.filter((x) => x !== positionId) : [...prev, positionId]
    );
  };

  const copyAddress = async () => {
    if (!address) return;

    await Clipboard.setStringAsync(address);
    setCopied(true);

    setTimeout(() => {
      setCopied(false);
    }, 1200);
  };

  const totalPositionValue = useMemo(() => {
    if (!details) return '0';
    return String(details.positionList.reduce((sum, position) => sum + getPositionValue(position), 0));
  }, [details]);

  const load = async () => {
    try {
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'clearinghouseState', user: address }),
      });

      const responseText = await res.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (error) {
        console.log('Hyperliquid response was not JSON:', responseText);
        Alert.alert('Error', text.invalidData);
        return;
      }

      // HIP-3 positions require a separate clearinghouseState call scoped to the
      // "xyz" dex. If it fails, fall back to the default-dex behaviour.
      let dexData;
      try {
        const dexRes = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'clearinghouseState', user: address, dex: 'xyz' }),
        });
        dexData = JSON.parse(await dexRes.text());
      } catch (error) {
        console.log('Hyperliquid xyz-dex request failed:', error);
      }

      const d = buildWalletDetails(data, dexData);

      const marketRes = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      });

      const marketText = await marketRes.text();
      let market;
      try {
        market = JSON.parse(marketText);
      } catch (error) {
        console.log('Hyperliquid market response was not JSON:', marketText);
        Alert.alert('Error', text.marketError);
        return;
      }

      // HIP-3 (xyz) coins are absent from the default universe, so fetch the
      // xyz market context too. If it fails, only default-dex prices resolve.
      let dexMarket;
      try {
        const dexMarketRes = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'metaAndAssetCtxs', dex: 'xyz' }),
        });
        dexMarket = JSON.parse(await dexMarketRes.text());
      } catch (error) {
        console.log('Hyperliquid xyz-market request failed:', error);
      }

      // Merge both universes/contexts index-aligned. xyz universe names carry an
      // "xyz:" prefix (matching the xyz assetPositions coin names) so they never
      // collide with the unprefixed default-dex names.
      const universe = [
        ...(Array.isArray(market?.[0]?.universe) ? market[0].universe : []),
        ...(Array.isArray(dexMarket?.[0]?.universe) ? dexMarket[0].universe : []),
      ];
      const assetCtxs = [
        ...(Array.isArray(market?.[1]) ? market[1] : []),
        ...(Array.isArray(dexMarket?.[1]) ? dexMarket[1] : []),
      ];

      const prices: Record<string, string> = {};
      const fundingRates: Record<string, string> = {};
      universe.forEach((a: any, i: number) => {
        prices[a.name] = String(assetCtxs[i]?.markPx ?? '0');
        fundingRates[a.name] = String(assetCtxs[i]?.funding ?? '0');
      });

      d.positionList = d.positionList.map((p) => ({
        ...p,
        currentPx: prices[p.coin] || '0',
        fundingRate: fundingRates[p.coin] || '0',
      }));
      setDetails(d);

      const fillsRes = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'userFills',
          user: address,
          aggregateByTime: false,
        }),
      });

      const fillsText = await fillsRes.text();
      console.log('FILLS RAW RESPONSE:', fillsText.slice(0, 3000));
      try {
        const fillsData = JSON.parse(fillsText);
        if (Array.isArray(fillsData)) {
          const rawFills: TradeItem[] = fillsData
            .sort((a: any, b: any) => Number(b.time ?? 0) - Number(a.time ?? 0))
            .slice(0, 200)
            .map((fill: any) => ({
              coin: String(fill.coin ?? 'Unknown'),
              side: String(fill.side ?? ''),
              px: String(fill.px ?? '0'),
              sz: String(fill.sz ?? '0'),
              time: Number(fill.time ?? Date.now()),
              pnl: fill.closedPnl ?? fill.realizedPnl ?? fill.pnl ?? undefined,
              dir: String(fill.dir ?? ''),
            }));

          setTradeHistory(aggregateTrades(rawFills).slice(0, 50));
        } else {
          setTradeHistory([]);
        }
      } catch (error) {
        console.log('Trade history response was not JSON:', fillsText);
        setTradeHistory([]);
      }

      // Resolve spot pair coins ("@N") to token names for display (cached).
      setSpotNames(await getSpotNameMap());
    } catch (error) {
      console.error('Fehler beim Laden:', error);
      Alert.alert('Error', text.loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, [address]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading && !details) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!details) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loaderWrap}>
          <Text style={styles.emptyText}>{text.noData}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen
  options={{
    headerShown: false,
  }}
/>

      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.container}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
          }
        >
          <View style={styles.topRow}>

  <TouchableOpacity
    style={styles.backButton}
    onPress={() => router.back()}
  >
    <Text style={styles.backButtonText}>‹</Text>
  </TouchableOpacity>

  <View style={styles.headerBlock}>
            
            <Text style={styles.walletName}>{walletName}</Text>
            <TouchableOpacity style={styles.addressCopyRow} onPress={copyAddress} activeOpacity={0.75}>
              <Text style={styles.walletAddress}>{shortenAddress(address)}</Text>
              <Text style={styles.copyText}>{copied ? text.copied : '⧉'}</Text>
            </TouchableOpacity>
          </View>
            </View>

          <View style={styles.equityBlock}>
            <Text style={styles.equityLabel}>{text.perpsEquity}</Text>
            <Text style={styles.equityValue}>{formatUSD(details.accountValue)}</Text>
            <Text style={styles.perpsOnlyText}>{text.perpsOnly}</Text>
          </View>

          <View style={styles.notificationsRow}>
            <Text style={styles.notificationsLabel}>{text.notifications}</Text>
            <Switch
              value={notificationsEnabled}
              onValueChange={toggleNotifications}
              disabled={notificationsBusy}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor={theme.card}
            />
          </View>

          <View style={styles.metricRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{text.unrealizedPnl}</Text>
              <Text
                style={[styles.metricValue, Number(details.totalUnrealizedPnl) >= 0 ? styles.green : styles.red]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {formatSignedUSD(details.totalUnrealizedPnl)}
              </Text>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>{text.positionValue}</Text>
              <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>
                {formatUSD(totalPositionValue)}
              </Text>
            </View>
          </View>

          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'positions' && styles.tabButtonActive]}
              onPress={() => setActiveTab('positions')}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabButtonText, activeTab === 'positions' && styles.tabButtonTextActive]}>
                {text.positions} ({details.positions})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'fills' && styles.tabButtonActive]}
              onPress={() => setActiveTab('fills')}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabButtonText, activeTab === 'fills' && styles.tabButtonTextActive]}>
                {text.tradeHistory}
              </Text>
            </TouchableOpacity>
          </View>

          {activeTab === 'positions' ? (
            details.positionList.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.emptyText}>{text.noOpenPositions}</Text>
            </View>
          ) : (
            details.positionList.map((p) => {
              const isLong = p.side === 'Long';
              const isProfit = Number(p.unrealizedPnl) >= 0;
              const coinInfo = parseFillCoin(p.coin);
              const isExpanded = expandedPositions.includes(p.id);
              const fundingNum = Number(p.fundingRate);
              const fundingUsdPer8h = Math.abs(fundingNum * Number(p.positionValue) * 8);

              return (
                <TouchableOpacity
                  key={p.id}
                  activeOpacity={0.9}
                  onPress={() => toggleExpanded(p.id)}
                  style={styles.positionCardModern}
                >
                  <View style={[styles.positionAccent, isLong ? styles.positionAccentLong : styles.positionAccentShort]} />

                  <View style={styles.positionBody}>
                    <View style={styles.positionTopRowModern}>
                      <View style={styles.positionTopLeftModern}>
                        <View style={styles.coinRowModern}>
                          <TouchableOpacity
                            onPress={() =>
                              router.push({
                                pathname: '/chart',
                                params: { coin: p.coin, themeMode },
                              })
                            }
                            activeOpacity={0.75}
                          >
                            <Text style={styles.positionCoinModern}>{coinInfo.symbol}</Text>
                          </TouchableOpacity>

                          {coinInfo.dex ? (
                            <View style={styles.dexBadge}>
                              <Text style={styles.dexBadgeText}>{coinInfo.dex}</Text>
                            </View>
                          ) : null}

                          <View style={[styles.sideBadgeModern, isLong ? styles.longBadge : styles.shortBadge]}>
                            <Text style={[styles.sideBadgeModernText, isLong ? styles.longText : styles.shortText]}>
                              {p.side.toUpperCase()}
                            </Text>
                          </View>

                          <View style={styles.leverageBadgeModern}>
                            <Text style={styles.leverageBadgeModernText}>{p.leverage}</Text>
                          </View>
                        </View>
                      </View>

                      <View style={styles.positionTopRightModern}>
                        <Text style={[styles.positionPnlModern, isProfit ? styles.green : styles.red]}>
                          {formatSignedUSD(p.unrealizedPnl)}
                        </Text>
                        <Text style={[styles.positionRoeModern, isProfit ? styles.green : styles.red]}>{p.roe}</Text>
                      </View>
                    </View>

                    <Text style={styles.positionMarketPriceModern}>{formatUSD(p.currentPx)}</Text>

                    <View style={styles.statsRowModern}>
                      <View style={styles.statItemModern}>
                        <Text style={styles.positionCellLabelModern}>{text.size}</Text>
                        <Text style={styles.positionCellValueModern}>{formatNumber(p.size)}</Text>
                      </View>

                      <View style={styles.statItemModern}>
                        <Text style={styles.positionCellLabelModern}>{text.entryPrice}</Text>
                        <Text style={styles.positionCellValueModern}>{formatUSD(p.entryPx)}</Text>
                      </View>

                      <View style={styles.statItemModern}>
                        <Text style={styles.positionCellLabelModern}>{text.fundingRate}</Text>
                        <Text style={[styles.positionCellValueModern, fundingNum > 0 ? styles.red : fundingNum < 0 ? styles.green : null]}>
                          {fundingNum > 0
                            ? `Pay ${formatUSD(fundingUsdPer8h)}/8h`
                            : fundingNum < 0
                              ? `Earn ${formatUSD(fundingUsdPer8h)}/8h`
                              : '—'}
                        </Text>
                      </View>
                    </View>

                    {isExpanded ? (
                      <View style={styles.statsRowModern}>
                        <View style={styles.statItemModern}>
                          <Text style={styles.positionCellLabelModern}>{text.positionValue}</Text>
                          <Text style={styles.positionCellValueModern}>{formatUSD(getPositionValue(p))}</Text>
                        </View>

                        <View style={styles.statItemModern}>
                          <Text style={styles.positionCellLabelModern}>{text.liquidationPrice}</Text>
                          <Text style={[styles.positionCellValueModern, p.liquidationPx !== '—' ? styles.red : null]}>
                            {p.liquidationPx === '—' ? '—' : formatUSD(p.liquidationPx)}
                          </Text>
                        </View>
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })
          )
          ) : (
          <View style={styles.tradeHistorySection}>
            {tradeHistory.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.emptyText}>{text.noTradesFound}</Text>
              </View>
            ) : (
              tradeHistory.map((trade, index) => {
                const isBuy = isBuySide(trade.side);
                const coinInfo = parseFillCoin(trade.coin);
                const fillKind = getFillKind(trade.dir);
                // Resolve spot pairs ("@N") to their token name; fall back to raw.
                const spotName = spotNames[trade.coin];
                const isSpot = !!spotName;
                const displaySymbol = spotName ?? coinInfo.symbol;
                return (
                  <View key={`${trade.coin}-${trade.time}-${index}`} style={styles.tradeCard}>
                    <View>
                      <View style={styles.tradeCoinRow}>
                        <Text style={[styles.tradeCoin, coinInfo.isId && !isSpot && styles.tradeCoinId]}>
                          {displaySymbol}
                        </Text>
                        {coinInfo.dex ? (
                          <View style={styles.dexBadge}>
                            <Text style={styles.dexBadgeText}>{coinInfo.dex}</Text>
                          </View>
                        ) : null}
                        {isSpot ? (
                          <View style={styles.spotBadge}>
                            <Text style={styles.spotBadgeText}>{text.spot}</Text>
                          </View>
                        ) : null}
                        {fillKind ? (
                          <View style={styles.fillKindBadge}>
                            <Text style={styles.fillKindText}>
                              {fillKind === 'open' ? text.fillOpened : text.fillClosed}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.tradeMeta}>{formatTradeTime(trade.time)}</Text>
                    </View>

                    <View style={styles.tradeRight}>
                      <Text style={[styles.tradeSide, isBuy ? styles.green : styles.red]}>
                        {isBuy ? 'BUY' : 'SELL'}
                      </Text>
                      <Text style={styles.tradeMeta}>
                        {formatNumber(trade.sz)} @ {formatUSD(trade.px)}
                      </Text>
                      {trade.count > 1 ? <Text style={styles.tradeCount}>{trade.count} {text.fills}</Text> : null}
                      {trade.pnl !== undefined && Math.abs(Number(trade.pnl)) > 0 ? (
                        <Text style={[styles.tradePnl, Number(trade.pnl) >= 0 ? styles.green : styles.red]}>
                          {formatSignedUSD(trade.pnl)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}
          </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const createStyles = (theme: typeof darkTheme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.background,
    },
    container: {
      padding: 20,
      paddingBottom: 40,
      backgroundColor: theme.background,
    },
    loaderWrap: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.background,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: 18,
      marginBottom: 24,
    },
    headerBlock: {
      flex: 1,
      marginBottom: 0,
    },
    walletName: {
      color: theme.text,
      fontSize: 30,
      fontWeight: 'bold',
      marginBottom: 6,
    },
    addressCopyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'flex-start',
    },
    walletAddress: {
      color: theme.textMuted,
      fontSize: 15,
    },
    copyText: {
      color: theme.primary,
      fontSize: 13,
      fontWeight: '800',
      minWidth: 24,
    },
    equityBlock: {
      marginBottom: 5,
    },
    equityLabel: {
      color: theme.textMuted,
      fontSize: 14,
      marginBottom: 6,
    },
    equityValue: {
      color: theme.text,
      fontSize: 36,
      fontWeight: 'bold',
    },
    perpsOnlyText: {
      color: theme.textMuted,
      fontSize: 12,
      marginTop: 4,
    },
    notificationsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.card,
      borderRadius: 14,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: 12,
    },
    notificationsLabel: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '600',
    },
    metricRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 18,
    },
    metricCard: {
      flex: 1,
      backgroundColor: theme.card,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: theme.border,
    },
    metricLabel: {
      color: theme.textMuted,
      fontSize: 11,
      marginBottom: 5,
    },
    metricValue: {
      color: theme.text,
      fontSize: 16,
      fontWeight: 'bold',
    },
    positionSectionTitle: {
      color: theme.text,
      fontSize: 24,
      fontWeight: 'bold',
    },
    tabBar: {
      flexDirection: 'row',
      backgroundColor: theme.cardSecondary,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 4,
      marginBottom: 14,
    },
    tabButton: {
      flex: 1,
      paddingVertical: 9,
      borderRadius: 10,
      alignItems: 'center',
    },
    tabButtonActive: {
      backgroundColor: theme.card,
    },
    tabButtonText: {
      color: theme.textMuted,
      fontSize: 14,
      fontWeight: '700',
    },
    tabButtonTextActive: {
      color: theme.text,
    },
    card: {
      backgroundColor: theme.card,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: 12,
    },
    positionCardModern: {
      backgroundColor: theme.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: 10,
      overflow: 'hidden',
      flexDirection: 'row',
    },
    positionAccent: {
      width: 6,
    },
    positionAccentLong: {
      backgroundColor: theme.green,
    },
    positionAccentShort: {
      backgroundColor: theme.red,
    },
    positionBody: {
      flex: 1,
      padding: 12,
    },
    positionTopRowModern: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    positionTopLeftModern: {
      flex: 1,
    },
    positionCoinModern: {
      color: theme.text,
      fontSize: 20,
      fontWeight: 'bold',
    },
    badgeRowModern: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 6,
      marginBottom: 6,
    },
    sideBadgeModern: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
    },
    sideBadgeModernText: {
      fontSize: 12,
      fontWeight: '800',
    },
    leverageBadgeModern: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: theme.cardSecondary,
      borderWidth: 1,
      borderColor: theme.border,
    },
    leverageBadgeModernText: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '800',
    },
    positionTopRightModern: {
      alignItems: 'flex-end',
    },
    positionPnlModern: {
      fontSize: 19,
      fontWeight: 'bold',
    },
    positionRoeModern: {
      fontSize: 13,
      fontWeight: '700',
      marginTop: 2,
    },
    positionMarketPriceModern: {
      color: theme.textMuted,
      fontSize: 14,
      marginBottom: 4,
    },
    fundingRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    fundingLabel: {
      color: theme.textMuted,
      fontSize: 13,
    },
    fundingValue: {
      fontSize: 13,
      fontWeight: '700',
    },
    coinRowModern: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 6,
    },
    statsRowModern: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 4,
    },
    statItemModern: {
      flex: 1,
    },
    positionGridModern: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      rowGap: 8,
    },
    positionCellModern: {
      width: '50%',
      paddingRight: 10,
    },
    positionCellLabelModern: {
      color: theme.textMuted,
      fontSize: 12,
      marginBottom: 3,
    },
    positionCellValueModern: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '600',
    },
    expandHint: {
      color: theme.textMuted,
      fontSize: 12,
      marginTop: 8,
    },
    longBadge: {
      backgroundColor: theme.greenBg,
    },
    shortBadge: {
      backgroundColor: theme.redBg,
    },
    longText: {
      color: theme.green,
    },
    shortText: {
      color: theme.red,
    },
    green: {
      color: theme.green,
    },
    red: {
      color: theme.red,
    },
    emptyText: {
      color: theme.textMuted,
    },
    tradeHistorySection: {
      marginTop: 8,
    },
    tradeCard: {
      backgroundColor: theme.card,
      borderRadius: 16,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: 8,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    tradeCoin: {
      color: theme.text,
      fontSize: 17,
      fontWeight: '700',
    },
    tradeCoinRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    tradeCoinId: {
      color: theme.textMuted,
      fontWeight: '600',
    },
    dexBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: theme.cardSecondary,
      borderWidth: 1,
      borderColor: theme.border,
    },
    dexBadgeText: {
      color: theme.textMuted,
      fontSize: 10,
      fontWeight: '700',
    },
    spotBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: theme.blueBg,
      borderWidth: 1,
      borderColor: theme.border,
    },
    spotBadgeText: {
      color: theme.primarySoft,
      fontSize: 10,
      fontWeight: '700',
    },
    fillKindBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: theme.cardSecondary,
    },
    fillKindText: {
      color: theme.textMuted,
      fontSize: 10,
      fontWeight: '700',
    },
    tradeMeta: {
      color: theme.textMuted,
      fontSize: 12,
      marginTop: 4,
    },
    tradeRight: {
      alignItems: 'flex-end',
      gap: 2,
    },
    tradeSide: {
      fontSize: 15,
      fontWeight: '800',
    },
    tradeCount: {
      color: theme.textMuted,
      fontSize: 11,
      marginTop: 2,
    },
    backButton: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: theme.card,
      borderWidth: 1,
      borderColor: theme.border,
      justifyContent: 'center',
      alignItems: 'center',
    },

backButtonText: {
  color: theme.text,
  fontSize: 42,
  lineHeight: 42,
  fontWeight: '500',
},
    
    tradePnl: {
  fontSize: 16,
  fontWeight: '700',
  marginTop: 4,
},
  });
