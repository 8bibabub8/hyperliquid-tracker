import { darkTheme, lightTheme } from '../theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Vibration,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Svg, {
  Path,
  Line,
  Defs,
  LinearGradient,
  Stop,
  Circle,
} from 'react-native-svg';

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
};

type WalletDetails = {
  accountValue: string;
  positions: number;
  totalUnrealizedPnl: string;
  positionList: PositionItem[];
};

type EquityPoint = {
  time: number;
  value: number;
};

function getEquityHistoryKey(address: string) {
  return `equity_history_${address.toLowerCase()}`;
}

function getChartRangeKey(address: string) {
  return `chart_range_${address.toLowerCase()}`;
}

function getChartModeKey(address: string) {
  return `chart_mode_${address.toLowerCase()}`;
}

function shortenAddress(address: string) {
  if (!address) return '';
  if (address.length < 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

function formatUSD(value: string) {
  const num = Number(value);
  if (isNaN(num)) return '$0';

  return '$' + num.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function formatSignedUSD(value: string) {
  const num = Number(value);
  if (isNaN(num)) return '$0';

  const sign = num >= 0 ? '+' : '-';
  return sign + '$' + Math.abs(num).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function formatNumber(value: string) {
  const num = Number(value);
  if (isNaN(num)) return '0';

  return num.toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

function formatMaybeUSD(value: string) {
  if (!value || value === '—') return '—';
  return formatUSD(value);
}

function formatCompactUSD(value: number) {
  const abs = Math.abs(value);

  if (abs >= 1_000_000_000) {
    return '$' + (value / 1_000_000_000).toFixed(1) + 'B';
  }

  if (abs >= 1_000_000) {
    return '$' + (value / 1_000_000).toFixed(1) + 'M';
  }

  if (abs >= 1_000) {
    return '$' + (value / 1_000).toFixed(1) + 'K';
  }

  return '$' + value.toFixed(0);
}

function formatXAxisLabel(timestamp: number, range: '1H' | '24H' | '7D' | 'All') {
  const d = new Date(timestamp);

  if (range === '1H' || range === '24H') {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
}

function buildWalletDetails(data: any): WalletDetails {
  const raw = data?.assetPositions ?? [];

  const positionList: PositionItem[] = raw.map((item: any) => {
    const p = item?.position ?? {};
    const size = Number(p?.szi ?? 0);

    const positionValue = Number(
      p?.positionValue ??
        p?.notionalUsd ??
        p?.notional ??
        0
    );

    const marginUsed = Number(
      p?.marginUsed ??
        p?.initialMargin ??
        0
    );

    let leverage = '—';
    if (marginUsed > 0) {
      const lev = positionValue / marginUsed;
      leverage = parseFloat(lev.toFixed(1)) + 'x';
    }

    let roe = '—';
    if (marginUsed > 0) {
      const roeValue = (Number(p?.unrealizedPnl ?? 0) / marginUsed) * 100;
      roe = roeValue.toFixed(1) + '%';
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
      liquidationPx: String(
        p?.liquidationPx ??
          p?.liqPx ??
          p?.liquidationPrice ??
          '—'
      ),
    };
  });

  const totalUnrealizedPnl = positionList.reduce((sum, p) => {
    return sum + Number(p.unrealizedPnl || 0);
  }, 0);

  return {
    accountValue: String(data?.marginSummary?.accountValue ?? '0'),
    positions: positionList.length,
    totalUnrealizedPnl: String(totalUnrealizedPnl),
    positionList,
  };
}

function getPositionValue(position: PositionItem) {
  const explicit = Number(position.positionValue);
  if (!isNaN(explicit) && explicit > 0) return explicit;

  const sizeAbs = Math.abs(Number(position.size));
  const price =
    Number(position.currentPx) > 0
      ? Number(position.currentPx)
      : Number(position.entryPx);

  return sizeAbs * price;
}

function buildChartPoints(
  points: EquityPoint[],
  width: number,
  height: number,
  padding: number
) {
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  return points.map((point, index) => {
    const x =
      padding + (index / Math.max(points.length - 1, 1)) * innerWidth;

    const y =
      padding +
      innerHeight -
      ((point.value - min) / range) * innerHeight;

    return { x, y, value: point.value, time: point.time };
  });
}

function buildSegmentPath(
  points: { x: number; y: number; value: number }[],
  baseline: number,
  mode: 'above' | 'below'
) {
  const filtered = points.map((p) => {
    const isAbove = p.value >= baseline;
    return mode === 'above' ? isAbove : !isAbove;
  });

  let path = '';

  for (let i = 0; i < points.length; i++) {
    if (!filtered[i]) continue;

    if (i > 0 && filtered[i - 1] && path) {
      path += ` L ${points[i].x} ${points[i].y}`;
    } else {
      path += `${path ? ' ' : ''}M ${points[i].x} ${points[i].y}`;
    }
  }

  return path;
}

function getMaxDrawdownPercent(values: number[]) {
  if (!values.length) return 0;

  let peak = values[0];
  let maxDd = 0;

  for (const value of values) {
    if (value > peak) peak = value;
    const dd = peak > 0 ? ((value - peak) / peak) * 100 : 0;
    if (dd < maxDd) maxDd = dd;
  }

  return maxDd;
}
function EquityChart({
  data,
  theme,
  range,
}: {
  data: EquityPoint[];
  theme: typeof darkTheme;
  range: '1H' | '24H' | '7D' | 'All';
}) {
  const width = 340;
  const height = 210;
  const padding = 12;

  if (!data.length) {
    return (
      <View style={stylesStatic.chartEmpty}>
        <Text style={{ color: theme.textMuted }}>
          Noch keine Chart-Daten vorhanden.
        </Text>
      </View>
    );
  }

  if (data.length === 1) {
    return (
      <View style={stylesStatic.chartEmpty}>
        <Text style={{ color: theme.textMuted }}>
          Noch mindestens einen weiteren Datenpunkt sammeln.
        </Text>
      </View>
    );
  }

  const values = data.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = buildChartPoints(data, width, height, padding);

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  const areaPath = [
    linePath,
    `L ${points[points.length - 1].x} ${height - padding}`,
    `L ${points[0].x} ${height - padding}`,
    'Z',
  ].join(' ');

  const greenPath = buildSegmentPath(points, 0, 'above');
  const redPath = buildSegmentPath(points, 0, 'below');

  const lastPoint = points[points.length - 1];
  const lastValue = data[data.length - 1].value;
  const lastColor = lastValue >= 0 ? theme.green : theme.red;

  return (
    <View style={{ flexDirection: 'row' }}>
      <View
        style={{
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          width: 46,
          marginRight: 4,
          paddingTop: 12,
          paddingBottom: 28,
        }}
      >
        <Text style={{ color: theme.textMuted, fontSize: 10 }}>
          {formatCompactUSD(max)}
        </Text>
        <Text style={{ color: theme.textMuted, fontSize: 10 }}>
          {formatCompactUSD(min)}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        <Svg width="100%" viewBox={`0 0 ${width} ${height}`} height={height}>
          <Defs>
            <LinearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={lastColor} stopOpacity="0.22" />
              <Stop offset="100%" stopColor={lastColor} stopOpacity="0.02" />
            </LinearGradient>
          </Defs>

          <Line
            x1={padding}
            y1={height - padding}
            x2={width - padding}
            y2={height - padding}
            stroke={theme.border}
            strokeWidth="1"
          />

          <Path d={areaPath} fill="url(#equityFill)" />

          {greenPath ? (
            <Path
              d={greenPath}
              fill="none"
              stroke={theme.green}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}

          {redPath ? (
            <Path
              d={redPath}
              fill="none"
              stroke={theme.red}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}

          <Circle
            cx={lastPoint.x}
            cy={lastPoint.y}
            r="4"
            fill={lastColor}
          />
        </Svg>

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginTop: 6,
          }}
        >
          <Text style={{ color: theme.textMuted, fontSize: 10 }}>
            {formatXAxisLabel(data[0].time, range)}
          </Text>

          <Text style={{ color: theme.textMuted, fontSize: 10 }}>
            {formatXAxisLabel(
              data[Math.floor(data.length / 2)].time,
              range
            )}
          </Text>

          <Text style={{ color: theme.textMuted, fontSize: 10 }}>
            {formatXAxisLabel(
              data[data.length - 1].time,
              range
            )}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function WalletDetailsScreen() {
  const params = useLocalSearchParams();

  const address = String(params.address || '');
  const walletName =
    typeof params.name === 'string' && params.name.trim()
      ? params.name
      : 'Wallet';
  const themeMode = String(params.themeMode || 'dark');

  const theme = themeMode === 'light' ? lightTheme : darkTheme;
  const styles = createStyles(theme);

  const [details, setDetails] = useState<WalletDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [equityHistory, setEquityHistory] = useState<EquityPoint[]>([]);
  const [chartRange, setChartRange] =
    useState<'1H' | '24H' | '7D' | 'All'>('All');
  const [chartMode, setChartMode] = useState<'equity' | 'pnl'>('equity');

  const [alertBars, setAlertBars] = useState<
    { id: number; text: string; type: 'open' | 'close' }[]
  >([]);

  const [prevPositions, setPrevPositions] = useState<PositionItem[]>([]);
  const [expandedPositions, setExpandedPositions] = useState<string[]>([]);

  const pushAlertBar = (text: string, type: 'open' | 'close') => {
    const id = Date.now() + Math.floor(Math.random() * 100000);

    if (type === 'open') {
      Vibration.vibrate(120);
    } else {
      Vibration.vibrate([0, 80, 60, 80]);
    }

    setAlertBars((prev) => [
      { id, text, type },
      ...prev.slice(0, 3),
    ]);

    setTimeout(() => {
      setAlertBars((prev) => prev.filter((item) => item.id !== id));
    }, 3000);
  };

  const toggleExpanded = (positionId: string) => {
    setExpandedPositions((prev) =>
      prev.includes(positionId)
        ? prev.filter((x) => x !== positionId)
        : [...prev, positionId]
    );
  };

  const totalPnl = useMemo(() => {
    if (equityHistory.length < 2) return '0';
    return String(
      equityHistory[equityHistory.length - 1].value - equityHistory[0].value
    );
  }, [equityHistory]);

  const totalPositionValue = useMemo(() => {
    if (!details) return '0';
    return String(
      details.positionList.reduce(
        (sum, position) => sum + getPositionValue(position),
        0
      )
    );
  }, [details]);

  const filteredEquityHistory = useMemo(() => {
    if (chartRange === 'All') return equityHistory;

    const now = Date.now();
    let cutoff = now;

    if (chartRange === '1H') {
      cutoff = now - 60 * 60 * 1000;
    } else if (chartRange === '24H') {
      cutoff = now - 24 * 60 * 60 * 1000;
    } else if (chartRange === '7D') {
      cutoff = now - 7 * 24 * 60 * 60 * 1000;
    }

    return equityHistory.filter((point) => point.time >= cutoff);
  }, [equityHistory, chartRange]);

  const chartSeries = useMemo(() => {
    if (chartMode === 'equity') return filteredEquityHistory;
    if (!filteredEquityHistory.length) return [];

    const base = filteredEquityHistory[0].value;

    return filteredEquityHistory.map((p) => ({
      time: p.time,
      value: p.value - base,
    }));
  }, [filteredEquityHistory, chartMode]);

  const chartDrawdown = useMemo(() => {
    if (!filteredEquityHistory.length) return 0;
    return getMaxDrawdownPercent(filteredEquityHistory.map((p) => p.value));
  }, [filteredEquityHistory]);
    useEffect(() => {
    const loadEquityHistory = async () => {
      if (!address) return;

      try {
        const saved = await AsyncStorage.getItem(getEquityHistoryKey(address));

        if (!saved) {
          setEquityHistory([]);
          return;
        }

        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setEquityHistory(parsed);
        }
      } catch (error) {
        console.error('Fehler beim Laden der Equity-History:', error);
      }
    };

    loadEquityHistory();
  }, [address]);

  useEffect(() => {
    const loadChartRange = async () => {
      if (!address) return;

      try {
        const saved = await AsyncStorage.getItem(getChartRangeKey(address));
        if (
          saved === '1H' ||
          saved === '24H' ||
          saved === '7D' ||
          saved === 'All'
        ) {
          setChartRange(saved);
        }
      } catch (error) {
        console.error('Fehler beim Laden von chartRange:', error);
      }
    };

    loadChartRange();
  }, [address]);

  useEffect(() => {
    const loadChartMode = async () => {
      if (!address) return;

      try {
        const saved = await AsyncStorage.getItem(getChartModeKey(address));
        if (saved === 'equity' || saved === 'pnl') {
          setChartMode(saved);
        }
      } catch (error) {
        console.error('Fehler beim Laden von chartMode:', error);
      }
    };

    loadChartMode();
  }, [address]);

  useEffect(() => {
    const saveChartRange = async () => {
      if (!address) return;

      try {
        await AsyncStorage.setItem(getChartRangeKey(address), chartRange);
      } catch (error) {
        console.error('Fehler beim Speichern von chartRange:', error);
      }
    };

    saveChartRange();
  }, [address, chartRange]);

  useEffect(() => {
    const saveChartMode = async () => {
      if (!address) return;

      try {
        await AsyncStorage.setItem(getChartModeKey(address), chartMode);
      } catch (error) {
        console.error('Fehler beim Speichern von chartMode:', error);
      }
    };

    saveChartMode();
  }, [address, chartMode]);

  const saveEquityPoint = async (accountValue: string) => {
    if (!address) return;

    const numericValue = Number(accountValue);
    if (isNaN(numericValue)) return;

    try {
      const key = getEquityHistoryKey(address);
      const now = Date.now();

      const nextPoint: EquityPoint = {
        time: now,
        value: numericValue,
      };

      const existingRaw = await AsyncStorage.getItem(key);
      const existing: EquityPoint[] = existingRaw ? JSON.parse(existingRaw) : [];

      const last = existing[existing.length - 1];
      const isTooCloseInTime = !!last && now - last.time < 60_000;
      const isSameValue = !!last && Math.abs(last.value - numericValue) < 0.0001;

      let updated = existing;

      if (!isTooCloseInTime || !isSameValue) {
        updated = [...existing, nextPoint].slice(-240);
        await AsyncStorage.setItem(key, JSON.stringify(updated));
        setEquityHistory(updated);
      } else {
        setEquityHistory(existing);
      }
    } catch (error) {
      console.error('Fehler beim Speichern der Equity-History:', error);
    }
  };

  const load = async () => {
    try {
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'clearinghouseState', user: address }),
      });

      const data = await res.json();
      const d = buildWalletDetails(data);
      await saveEquityPoint(d.accountValue);

      const marketRes = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      });

      const market = await marketRes.json();

      const prices: Record<string, string> = {};
      if (Array.isArray(market?.[0]?.universe) && Array.isArray(market?.[1])) {
        market[0].universe.forEach((a: any, i: number) => {
          prices[a.name] = String(market[1][i]?.markPx ?? '0');
        });
      }

      d.positionList = d.positionList.map((p) => ({
        ...p,
        currentPx: prices[p.coin] || '0',
      }));

      const opened = d.positionList.filter(
        (p) =>
          !prevPositions.some((x) => x.coin === p.coin) &&
          getPositionValue(p) >= 100
      );

      const closed = prevPositions.filter(
        (p) =>
          !d.positionList.some((x) => x.coin === p.coin) &&
          getPositionValue(p) >= 100
      );

      const persistedCoins = d.positionList.filter((current) =>
        prevPositions.some((x) => x.coin === current.coin)
      );

      const increased = persistedCoins.filter((current) => {
        const previous = prevPositions.find((x) => x.coin === current.coin);
        if (!previous) return false;

        const currentSize = Math.abs(Number(current.size));
        const previousSize = Math.abs(Number(previous.size));

        return currentSize > previousSize && getPositionValue(current) >= 100;
      });

      const decreased = persistedCoins.filter((current) => {
        const previous = prevPositions.find((x) => x.coin === current.coin);
        if (!previous) return false;

        const currentSize = Math.abs(Number(current.size));
        const previousSize = Math.abs(Number(previous.size));

        return currentSize < previousSize && getPositionValue(previous) >= 100;
      });

      opened.forEach((p) => pushAlertBar(`Opened ${p.coin} ${p.side}`, 'open'));
      closed.forEach((p) => pushAlertBar(`Closed ${p.coin}`, 'close'));
      increased.forEach((p) => pushAlertBar(`Increased ${p.coin}`, 'open'));
      decreased.forEach((p) => pushAlertBar(`Decreased ${p.coin}`, 'close'));

      setPrevPositions(d.positionList);
      setDetails(d);
    } catch {
      Alert.alert('Fehler beim Laden');
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
          <Text style={styles.emptyText}>Keine Daten</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.primary}
          />
        }
      >
        {alertBars.length > 0 && (
          <View style={styles.alertStack}>
            {alertBars.map((item) => (
              <View
                key={item.id}
                style={[
                  styles.alertBar,
                  item.type === 'open'
                    ? styles.alertBarOpen
                    : styles.alertBarClose,
                ]}
              >
                <View style={styles.alertBarRow}>
                  <View
                    style={[
                      styles.alertDot,
                      item.type === 'open'
                        ? styles.alertDotOpen
                        : styles.alertDotClose,
                    ]}
                  />
                  <Text style={styles.alertBarText}>{item.text}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.headerBlock}>
          <Text style={styles.walletName}>{walletName}</Text>
          <Text style={styles.walletAddress}>{shortenAddress(address)}</Text>
        </View>

        <View style={styles.equityBlock}>
          <Text style={styles.equityLabel}>Total Equity</Text>
          <Text style={styles.equityValue}>
            {formatUSD(details.accountValue)}
          </Text>
        </View>

        <View style={styles.chartModeRow}>
          <TouchableOpacity
            style={[
              styles.chartModeButton,
              chartMode === 'equity' ? styles.chartModeButtonActive : null,
            ]}
            onPress={() => setChartMode('equity')}
          >
            <Text
              style={[
                styles.chartModeText,
                chartMode === 'equity' ? styles.chartModeTextActive : null,
              ]}
            >
              Equity
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.chartModeButton,
              chartMode === 'pnl' ? styles.chartModeButtonActive : null,
            ]}
            onPress={() => setChartMode('pnl')}
          >
            <Text
              style={[
                styles.chartModeText,
                chartMode === 'pnl' ? styles.chartModeTextActive : null,
              ]}
            >
              PnL
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.chartCard}>
          <View style={styles.chartHeaderRow}>
            <View>
              <Text style={styles.chartMetaTitle}>
                Drawdown: {chartDrawdown.toFixed(1)}%
              </Text>
            </View>

            <View style={styles.chartTabs}>
              <TouchableOpacity
                style={[
                  styles.chartTabButton,
                  chartRange === '1H' ? styles.chartTabButtonActive : null,
                ]}
                onPress={() => setChartRange('1H')}
              >
                <Text
                  style={[
                    styles.chartTabText,
                    chartRange === '1H' ? styles.chartTabTextActive : null,
                  ]}
                >
                  1H
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.chartTabButton,
                  chartRange === '24H' ? styles.chartTabButtonActive : null,
                ]}
                onPress={() => setChartRange('24H')}
              >
                <Text
                  style={[
                    styles.chartTabText,
                    chartRange === '24H' ? styles.chartTabTextActive : null,
                  ]}
                >
                  24H
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.chartTabButton,
                  chartRange === '7D' ? styles.chartTabButtonActive : null,
                ]}
                onPress={() => setChartRange('7D')}
              >
                <Text
                  style={[
                    styles.chartTabText,
                    chartRange === '7D' ? styles.chartTabTextActive : null,
                  ]}
                >
                  7D
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.chartTabButton,
                  chartRange === 'All' ? styles.chartTabButtonActive : null,
                ]}
                onPress={() => setChartRange('All')}
              >
                <Text
                  style={[
                    styles.chartTabText,
                    chartRange === 'All' ? styles.chartTabTextActive : null,
                  ]}
                >
                  All
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <EquityChart
            data={chartSeries}
            theme={theme}
            range={chartRange}
          />
        </View>
                <View style={styles.kpiGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>PnL</Text>
            <Text
              style={[
                styles.kpiValue,
                Number(totalPnl) >= 0 ? styles.green : styles.red,
              ]}
            >
              {formatSignedUSD(totalPnl)}
            </Text>
          </View>

          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Unrealized PnL</Text>
            <Text
              style={[
                styles.kpiValue,
                Number(details.totalUnrealizedPnl) >= 0
                  ? styles.green
                  : styles.red,
              ]}
            >
              {formatSignedUSD(details.totalUnrealizedPnl)}
            </Text>
          </View>

          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Positions</Text>
            <Text style={styles.kpiValue}>{details.positions}</Text>
          </View>

          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Position Value</Text>
            <Text style={styles.kpiValue}>{formatUSD(totalPositionValue)}</Text>
          </View>
        </View>

        <View style={styles.positionSectionHeader}>
          <Text style={styles.positionSectionTitle}>
            Positions ({details.positions})
          </Text>
        </View>

        {details.positionList.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyText}>Keine offenen Positionen.</Text>
          </View>
        ) : (
          details.positionList.map((p) => {
            const isLong = p.side === 'Long';
            const isProfit = Number(p.unrealizedPnl) >= 0;
            const isExpanded = expandedPositions.includes(p.id);

            return (
              <TouchableOpacity
                key={p.id}
                activeOpacity={0.9}
                onPress={() => toggleExpanded(p.id)}
                style={styles.positionCardModern}
              >
                <View
                  style={[
                    styles.positionAccent,
                    isLong
                      ? styles.positionAccentLong
                      : styles.positionAccentShort,
                  ]}
                />

                <View style={styles.positionBody}>
                  <View style={styles.positionTopRowModern}>
                    <View style={styles.positionTopLeftModern}>
                      <Text style={styles.positionCoinModern}>{p.coin}</Text>

                      <View style={styles.badgeRowModern}>
                        <View
                          style={[
                            styles.sideBadgeModern,
                            isLong ? styles.longBadge : styles.shortBadge,
                          ]}
                        >
                          <Text
                            style={[
                              styles.sideBadgeModernText,
                              isLong ? styles.longText : styles.shortText,
                            ]}
                          >
                            {p.side.toUpperCase()}
                          </Text>
                        </View>

                        <View style={styles.leverageBadgeModern}>
                          <Text style={styles.leverageBadgeModernText}>
                            {p.leverage}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.positionTopRightModern}>
                      <Text
                        style={[
                          styles.positionPnlModern,
                          isProfit ? styles.green : styles.red,
                        ]}
                      >
                        {formatSignedUSD(p.unrealizedPnl)}
                      </Text>

                      <Text
                        style={[
                          styles.positionRoeModern,
                          isProfit ? styles.green : styles.red,
                        ]}
                      >
                        {p.roe}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.positionMarketPriceModern}>
                    {formatUSD(p.currentPx)}
                  </Text>

                  <View style={styles.positionGridModern}>
                    <View style={styles.positionCellModern}>
                      <Text style={styles.positionCellLabelModern}>Size</Text>
                      <Text style={styles.positionCellValueModern}>
                        {formatNumber(p.size)}
                      </Text>
                    </View>

                    <View style={styles.positionCellModern}>
                      <Text style={styles.positionCellLabelModern}>
                        Entry Price
                      </Text>
                      <Text style={styles.positionCellValueModern}>
                        {formatUSD(p.entryPx)}
                      </Text>
                    </View>

                    {isExpanded ? (
                      <>
                        <View style={styles.positionCellModern}>
                          <Text style={styles.positionCellLabelModern}>
                            Current Price
                          </Text>
                          <Text style={styles.positionCellValueModern}>
                            {formatUSD(p.currentPx)}
                          </Text>
                        </View>

                        <View style={styles.positionCellModern}>
                          <Text style={styles.positionCellLabelModern}>Leverage</Text>
                          <Text style={styles.positionCellValueModern}>
                            {p.leverage}
                          </Text>
                        </View>

                        <View style={styles.positionCellModern}>
                          <Text style={styles.positionCellLabelModern}>
                            Position Value
                          </Text>
                          <Text style={styles.positionCellValueModern}>
                            {formatMaybeUSD(
                              p.positionValue === '0'
                                ? String(getPositionValue(p))
                                : p.positionValue
                            )}
                          </Text>
                        </View>

                        <View style={styles.positionCellModern}>
                          <Text style={styles.positionCellLabelModern}>
                            Liquidation Price
                          </Text>
                          <Text
                            style={[
                              styles.positionCellValueModern,
                              p.liquidationPx !== '—' ? styles.red : null,
                            ]}
                          >
                            {p.liquidationPx === '—'
                              ? '—'
                              : formatUSD(p.liquidationPx)}
                          </Text>
                        </View>
                      </>
                    ) : null}
                  </View>

                  <Text style={styles.expandHint}>
                    {isExpanded ? 'Tap to collapse' : 'Tap for more details'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const stylesStatic = StyleSheet.create({
  chartEmpty: {
    height: 210,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

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

    headerBlock: {
      marginBottom: 18,
    },
    walletName: {
      color: theme.text,
      fontSize: 30,
      fontWeight: 'bold',
      marginBottom: 4,
    },
    walletAddress: {
      color: theme.textMuted,
      fontSize: 15,
    },

    equityBlock: {
      marginBottom: 18,
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

    chartModeRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 12,
    },
    chartModeButton: {
      backgroundColor: theme.cardSecondary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
    },
    chartModeButtonActive: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    chartModeText: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    chartModeTextActive: {
      color: '#ffffff',
    },

    chartCard: {
      backgroundColor: theme.card,
      borderRadius: 24,
      padding: 18,
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: 16,
    },
    chartHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    chartMetaTitle: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    chartTabs: {
      flexDirection: 'row',
      gap: 6,
    },
    chartTabButton: {
      backgroundColor: theme.cardSecondary,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
    },
    chartTabButtonActive: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    chartTabText: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    chartTabTextActive: {
      color: '#ffffff',
    },

    kpiGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 16,
    },
    kpiCard: {
      width: '48%',
      backgroundColor: theme.card,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: theme.border,
    },
    kpiLabel: {
      color: theme.textMuted,
      fontSize: 12,
      marginBottom: 6,
    },
    kpiValue: {
      color: theme.text,
      fontSize: 20,
      fontWeight: 'bold',
    },

    alertStack: {
      marginBottom: 10,
      gap: 6,
    },
    alertBar: {
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 10,
      alignItems: 'center',
    },
    alertBarOpen: {
      backgroundColor: theme.greenBg,
      borderWidth: 1,
      borderColor: theme.green,
    },
    alertBarClose: {
      backgroundColor: theme.redBg,
      borderWidth: 1,
      borderColor: theme.red,
    },
    alertBarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    alertDot: {
      width: 6,
      height: 6,
      borderRadius: 999,
      marginRight: 6,
    },
    alertDotOpen: {
      backgroundColor: theme.green,
    },
    alertDotClose: {
      backgroundColor: theme.red,
    },
    alertBarText: {
      fontWeight: '600',
      fontSize: 13,
      color: theme.text,
    },

    positionSectionHeader: {
      marginBottom: 12,
    },
    positionSectionTitle: {
      color: theme.text,
      fontSize: 22,
      fontWeight: 'bold',
    },

    card: {
      backgroundColor: theme.card,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: 16,
    },

    positionCardModern: {
      backgroundColor: theme.card,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: 16,
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
      padding: 18,
    },
    positionTopRowModern: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 10,
    },
    positionTopLeftModern: {
      flex: 1,
      marginRight: 10,
    },
    positionCoinModern: {
      color: theme.text,
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 6,
    },
    badgeRowModern: {
      flexDirection: 'row',
      gap: 8,
      flexWrap: 'wrap',
    },
    sideBadgeModern: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
    },
    sideBadgeModernText: {
      fontSize: 12,
      fontWeight: 'bold',
    },
    leverageBadgeModern: {
      backgroundColor: theme.cardSecondary,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
    },
    leverageBadgeModernText: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: 'bold',
    },
    positionTopRightModern: {
      alignItems: 'flex-end',
    },
    positionPnlModern: {
      fontSize: 22,
      fontWeight: 'bold',
    },
    positionRoeModern: {
      fontSize: 13,
      fontWeight: '600',
      marginTop: 2,
    },
    positionMarketPriceModern: {
      color: theme.textMuted,
      fontSize: 14,
      marginBottom: 14,
    },
    positionGridModern: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      rowGap: 14,
    },
    positionCellModern: {
      width: '50%',
      paddingRight: 10,
    },
    positionCellLabelModern: {
      color: theme.textMuted,
      fontSize: 12,
      marginBottom: 6,
    },
    positionCellValueModern: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '600',
    },
    expandHint: {
      color: theme.textMuted,
      fontSize: 12,
      marginTop: 14,
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
  });