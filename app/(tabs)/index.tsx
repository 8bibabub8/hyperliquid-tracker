import { darkTheme, lightTheme } from '../../theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import * as Localization from 'expo-localization';
import * as Notifications from 'expo-notifications';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const SUPABASE_FUNCTIONS_URL = 'https://cvdnudenzjooginvgbnt.supabase.co/functions/v1';
const STORAGE_WALLETS_KEY = 'tracked_wallets';
const STORAGE_THEME_KEY = 'theme_mode';
const STORAGE_PUSH_TOKEN_KEY = 'push_token';

type ThemeMode = 'dark' | 'light';

type StoredWallet = {
  address: string;
  name: string;
};

type WalletCard = StoredWallet & {
  pnl: number;
  roi: number;
  positions: number;
  equity: number;
  badges: string[];
};

const deText = {
  title: 'Perp Position Tracker',
  subtitle: 'Tracke öffentliche Wallets und ihre Aktivität.',
  updated: 'Aktualisiert',
  addWallet: 'Wallet hinzufügen',
  walletName: 'Wallet-Name',
  walletNamePlaceholder: 'z. B. BTC Whale',
  walletAddress: 'Wallet-Adresse',
  addressPlaceholder: '0x...',
  trackWallet: 'Wallet tracken',
  cancel: 'Abbrechen',
  renameWallet: 'Wallet umbenennen',
  newName: 'Neuer Name',
  error: 'Fehler',
  addressMissing: 'Wallet-Adresse fehlt.',
  alreadyTracked: 'Diese Wallet wird bereits getrackt.',
  invalidAddress: 'Bitte gib eine gültige Wallet-Adresse ein.',
  deleteTitle: 'Wallet löschen?',
  deleteMessage: 'Diese Wallet wird aus der App entfernt und ihre gespeicherten Daten werden in Supabase gelöscht.',
  deleteCancel: 'Abbrechen',
  deleteConfirm: 'Löschen',
  deleteFailed: 'Konnte nicht gelöscht werden, bitte erneut versuchen.',
  copied: 'Adresse kopiert',
  perps: 'Perps',
  roi: 'ROI',
  pos: 'Pos',
  noWallets: 'Noch keine Wallets',
  noWalletsHint: 'Tippe oben rechts auf das Wallet-Symbol, um eine Wallet hinzuzufügen.',
  loadDemo: 'Demo-Wallet laden',
};

const enText: typeof deText = {
  title: 'Perp Position Tracker',
  subtitle: 'Track public wallets and their activity.',
  updated: 'Updated',
  addWallet: 'Add Wallet',
  walletName: 'Wallet name',
  walletNamePlaceholder: 'e.g. BTC Whale',
  walletAddress: 'Wallet address',
  addressPlaceholder: '0x...',
  trackWallet: 'Track wallet',
  cancel: 'Cancel',
  renameWallet: 'Rename wallet',
  newName: 'New name',
  error: 'Error',
  addressMissing: 'Wallet address missing.',
  alreadyTracked: 'Wallet already tracked.',
  invalidAddress: 'Please enter a valid wallet address.',
  deleteTitle: 'Delete wallet?',
  deleteMessage: 'This wallet will be removed from the app and its stored data will be deleted in Supabase.',
  deleteCancel: 'Cancel',
  deleteConfirm: 'Delete',
  deleteFailed: 'Could not delete, please try again.',
  copied: 'Address copied',
  perps: 'Perps',
  roi: 'ROI',
  pos: 'Pos',
  noWallets: 'No wallets yet',
  noWalletsHint: 'Tap the wallet icon in the top right to add a wallet.',
  loadDemo: 'Load demo wallet',
};

function getAppText() {
  const locale = (Localization.getLocales()[0]?.languageCode ?? 'en').toLowerCase();
  return locale.startsWith('de') ? deText : enText;
}

function normalizeAddress(address: string) {
  return address.trim().toLowerCase();
}

function isValidWalletAddress(address: string) {
  const a = normalizeAddress(address);
  return a.startsWith('0x') && a.length >= 20;
}

function shortenAddress(address: string) {
  if (!address) return '';
  if (address.length < 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

function formatCompactUSD(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  }

  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  }

  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  }

  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

async function getExpoPushToken() {
  try {
    console.log('Constants.isDevice:', Constants.isDevice);

    const existing = await Notifications.getPermissionsAsync();
    console.log('Existing notification permission:', existing);

    let status = existing.status;

    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      console.log('Requested notification permission:', requested);
      status = requested.status;
    }

    if (status !== 'granted') {
      console.log('Notifications not granted.');
      return null;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    console.log('Expo projectId:', projectId);

    if (!projectId) {
      console.log('No Expo projectId found.');
      return null;
    }

    const tokenResult = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    console.log('Expo push token result:', tokenResult);

    // Persist the last successful token so token-dependent calls (e.g. delete)
    // can still run when getExpoPushTokenAsync is intermittently unavailable.
    if (tokenResult.data) {
      try {
        await AsyncStorage.setItem(STORAGE_PUSH_TOKEN_KEY, tokenResult.data);
      } catch {}
    }

    return tokenResult.data;
  } catch (error) {
    console.log('Push token error:', error);
    return null;
  }
}

async function registerWalletInSupabase(wallet: StoredWallet) {
  try {
    const pushToken = await getExpoPushToken();

    console.log('Push token:', pushToken);
    console.log('Registering wallet:', wallet);
    
    if (!pushToken) {
      console.log('No push token available.');
      return;
    }

    await fetch(`${SUPABASE_FUNCTIONS_URL}/register-wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pushToken,
        address: normalizeAddress(wallet.address),
        name: wallet.name || 'Wallet',
        platform: Platform.OS,
      }),
    });
  } catch (error) {
    console.log('register-wallet failed:', error);
  }
}

async function unregisterWalletInSupabase(address: string) {
  // Prefer a freshly fetched token, fall back to the last persisted one so a
  // flaky getExpoPushToken() does not block deletion. Only when both are
  // missing can the call not be made.
  let pushToken = await getExpoPushToken();

  if (!pushToken) {
    pushToken = await AsyncStorage.getItem(STORAGE_PUSH_TOKEN_KEY);
  }

  if (!pushToken) {
    throw new Error('No push token available for unregister.');
  }

  const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/unregister-wallet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pushToken,
      address: normalizeAddress(address),
    }),
  });

  if (!response.ok) {
    throw new Error(`unregister-wallet failed with status ${response.status}`);
  }
}

async function fetchWalletCard(wallet: StoredWallet): Promise<WalletCard> {
  try {
    const response = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clearinghouseState',
        user: normalizeAddress(wallet.address),
      }),
    });

    const data = await response.json();
    const positions = Array.isArray(data?.assetPositions) ? data.assetPositions : [];

    const pnl = positions.reduce((sum: number, item: any) => {
      return sum + Number(item?.position?.unrealizedPnl ?? 0);
    }, 0);

    const equity = Number(data?.marginSummary?.accountValue ?? 0);
    // ROI is measured against the capital basis before the open PnL
    // (equity − unrealizedPnl), not the post-loss equity. Dividing by the
    // remaining equity makes the ratio explode past -100% as it nears liquidation.
    const costBasis = equity - pnl;
    const roi = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

    const badges = positions.slice(0, 3).map((item: any) => {
      const p = item?.position ?? {};
      const coin = String(p?.coin ?? 'Unknown');
      const size = Number(p?.szi ?? 0);
      return `${coin} ${size >= 0 ? 'LONG' : 'SHORT'}`;
    });

    return {
      address: normalizeAddress(wallet.address),
      name: wallet.name || 'Wallet',
      pnl,
      roi,
      positions: positions.length,
      equity,
      badges,
    };
  } catch (error) {
    console.log('Wallet fetch failed:', error);

    return {
      address: normalizeAddress(wallet.address),
      name: wallet.name || 'Wallet',
      pnl: 0,
      roi: 0,
      positions: 0,
      equity: 0,
      badges: [],
    };
  }
}

export default function IndexScreen() {
  const text = useMemo(() => getAppText(), []);
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const [wallets, setWallets] = useState<WalletCard[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const [addModalVisible, setAddModalVisible] = useState(false);
  const [walletName, setWalletName] = useState('');
  const [walletAddress, setWalletAddress] = useState('');

  const theme = themeMode === 'dark' ? darkTheme : lightTheme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const loadTheme = async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_THEME_KEY);
      if (saved === 'dark' || saved === 'light') {
        setThemeMode(saved);
      }
    } catch {}
  };

  const loadWallets = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_WALLETS_KEY);
      const stored: StoredWallet[] = raw ? JSON.parse(raw) : [];

      const next = await Promise.all(stored.map(fetchWalletCard));

      setWallets(next);
      
      for (const wallet of stored) {
        await registerWalletInSupabase(wallet);
      }
      setUpdatedAt(new Date());
    } catch (error) {
      console.log('loadWallets failed:', error);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadTheme();
      loadWallets();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadWallets();
    setRefreshing(false);
  };

  const toggleTheme = async () => {
    const next = themeMode === 'dark' ? 'light' : 'dark';
    setThemeMode(next);
    await AsyncStorage.setItem(STORAGE_THEME_KEY, next);
  };

  const addWallet = async (addressArg?: string, nameArg?: string) => {
    const rawAddress = addressArg ?? walletAddress;
    const rawName = nameArg ?? walletName;
    const address = normalizeAddress(rawAddress);
    const name = rawName.trim() || 'Wallet';

    if (!address) {
      Alert.alert(text.error, text.addressMissing);
      return;
    }

    if (!isValidWalletAddress(address)) {
      Alert.alert(text.error, text.invalidAddress);
      return;
    }

    try {
      const raw = await AsyncStorage.getItem(STORAGE_WALLETS_KEY);
      const stored: StoredWallet[] = raw ? JSON.parse(raw) : [];

      const exists = stored.some((w) => normalizeAddress(w.address) === address);

      if (exists) {
        Alert.alert(text.error, text.alreadyTracked);
        return;
      }

      const wallet: StoredWallet = { address, name };
      const next = [...stored, wallet];

      await AsyncStorage.setItem(STORAGE_WALLETS_KEY, JSON.stringify(next));
      await registerWalletInSupabase(wallet);

      setWalletName('');
      setWalletAddress('');
      setAddModalVisible(false);

      await loadWallets();
    } catch (error) {
      console.log('addWallet failed:', error);
    }
  };

  const renameWallet = async (address: string) => {
    Alert.prompt(
      text.renameWallet,
      text.newName,
      async (value) => {
        const nextName = value?.trim();
        if (!nextName) return;

        const raw = await AsyncStorage.getItem(STORAGE_WALLETS_KEY);
        const stored: StoredWallet[] = raw ? JSON.parse(raw) : [];

        const next = stored.map((w) =>
          normalizeAddress(w.address) === normalizeAddress(address)
            ? { ...w, name: nextName }
            : w
        );

        await AsyncStorage.setItem(STORAGE_WALLETS_KEY, JSON.stringify(next));
        await registerWalletInSupabase({ address, name: nextName });
        await loadWallets();
      },
      'plain-text'
    );
  };

  const deleteWallet = async (address: string) => {
    Alert.alert(text.deleteTitle, text.deleteMessage, [
      { text: text.deleteCancel, style: 'cancel' },
      {
        text: text.deleteConfirm,
        style: 'destructive',
        onPress: async () => {
          // Delete server-side first; only drop the wallet locally once the
          // cleanup succeeded, so a failed call leaves the wallet in place.
          try {
            await unregisterWalletInSupabase(address);
          } catch (error) {
            console.log('unregister-wallet failed:', error);
            Alert.alert(text.error, text.deleteFailed);
            return;
          }

          const raw = await AsyncStorage.getItem(STORAGE_WALLETS_KEY);
          const stored: StoredWallet[] = raw ? JSON.parse(raw) : [];

          const next = stored.filter(
            (w) => normalizeAddress(w.address) !== normalizeAddress(address)
          );

          await AsyncStorage.setItem(STORAGE_WALLETS_KEY, JSON.stringify(next));
          await loadWallets();
        },
      },
    ]);
  };

  const openWallet = (wallet: WalletCard) => {
    router.push({
      pathname: '/wallet-details',
      params: {
        address: wallet.address,
        name: wallet.name,
        themeMode,
      },
    });
  };

  const copyAddress = async (address: string) => {
    await Clipboard.setStringAsync(address);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerTextBlock}>
            <Text style={styles.title}>{text.title}</Text>
            <Text style={styles.subtitle}>{text.subtitle}</Text>
            <Text style={styles.updatedText}>
              {text.updated}: {updatedAt ? formatTime(updatedAt) : '—'}
            </Text>
          </View>

          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.headerButton} onPress={toggleTheme} activeOpacity={0.8}>
              <Ionicons
                name={themeMode === 'dark' ? 'sunny-outline' : 'moon-outline'}
                size={24}
                color={theme.text}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.headerButton, styles.addHeaderButton]}
              onPress={() => setAddModalVisible(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="wallet-outline" size={25} color="#fff" />
              <View style={styles.addMiniBadge}>
                <Ionicons name="add" size={12} color="#fff" />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {wallets.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="wallet-outline" size={38} color={theme.primary} />
            <Text style={styles.emptyTitle}>{text.noWallets}</Text>
            <Text style={styles.emptyHint}>{text.noWalletsHint}</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => addWallet('0x4e23288cee4960f9f962195c22948e4bc7ae20c3', 'Demo Wallet')}
            >
              <Text style={styles.primaryButtonText}>{text.loadDemo}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {wallets.map((wallet) => {
          const isProfit = wallet.pnl >= 0;

          return (
            <TouchableOpacity
              key={wallet.address}
              activeOpacity={0.9}
              style={styles.walletCard}
              onPress={() => openWallet(wallet)}
            >
              <View style={styles.walletTopRow}>
                <View style={styles.walletLeft}>
                  <View style={styles.nameRow}>
                    <Text style={styles.walletName} numberOfLines={1}>
                      {wallet.name}
                    </Text>

                    <View style={styles.nameActions}>
                      <TouchableOpacity
                        style={styles.inlineIconButton}
                        onPress={(event) => {
                          event.stopPropagation();
                          renameWallet(wallet.address);
                        }}
                      >
                        <Ionicons name="pencil-outline" size={15} color={theme.primary} />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.inlineIconButton}
                        onPress={(event) => {
                          event.stopPropagation();
                          deleteWallet(wallet.address);
                        }}
                      >
                        <Ionicons name="trash-outline" size={15} color={theme.red} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.addressRow}>
                    <Text style={styles.walletAddress}>{shortenAddress(wallet.address)}</Text>
                    <TouchableOpacity
                      onPress={(event) => {
                        event.stopPropagation();
                        copyAddress(wallet.address);
                      }}
                      style={styles.copyButton}
                    >
                      <Ionicons name="copy-outline" size={15} color={theme.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.pnlBlock}>
                  <Text style={[styles.pnlValue, isProfit ? styles.green : styles.red]}>
                    {isProfit ? '▲' : '▼'} {isProfit ? '+' : '-'}
                    {formatCompactUSD(Math.abs(wallet.pnl))}
                  </Text>
                  <Text style={[styles.roiValue, isProfit ? styles.green : styles.red]}>
                    {wallet.roi.toFixed(2)}%
                  </Text>
                </View>
              </View>

              <View style={styles.badgeRow}>
                {wallet.badges.map((badge, index) => {
                  const isLong = badge.includes('LONG');

                  return (
                    <View key={`${badge}-${index}`} style={[styles.badge, isLong ? styles.longBadge : styles.shortBadge]}>
                      <Text style={[styles.badgeText, isLong ? styles.longText : styles.shortText]}>{badge}</Text>
                    </View>
                  );
                })}
              </View>

              <View style={styles.divider} />

              <View style={styles.footerStats}>
                <Text style={styles.footerStat}>{text.perps} {formatCompactUSD(wallet.equity)}</Text>
                <Text style={[styles.footerStatStrong, wallet.roi >= 0 ? styles.green : styles.red]}>
                  {text.roi} {wallet.roi.toFixed(2)}%
                </Text>
                <Text style={styles.footerStat}>{text.pos} {wallet.positions}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Modal visible={addModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{text.addWallet}</Text>

            <Text style={styles.inputLabel}>{text.walletName}</Text>
            <TextInput
              value={walletName}
              onChangeText={setWalletName}
              placeholder={text.walletNamePlaceholder}
              placeholderTextColor={theme.textMuted}
              style={styles.input}
            />

            <Text style={styles.inputLabel}>{text.walletAddress}</Text>
            <TextInput
              value={walletAddress}
              onChangeText={setWalletAddress}
              placeholder={text.addressPlaceholder}
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />

            <TouchableOpacity style={styles.primaryButton} onPress={() => addWallet()}>
              <Text style={styles.primaryButtonText}>{text.trackWallet}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={() => setAddModalVisible(false)}>
              <Text style={styles.cancelButtonText}>{text.cancel}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (theme: typeof darkTheme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.background,
    },
    container: {
      paddingHorizontal: 22,
      paddingTop: 28,
      paddingBottom: 90,
      backgroundColor: theme.background,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 26,
      gap: 14,
    },
    headerTextBlock: {
      flex: 1,
      paddingRight: 4,
    },
    title: {
      color: theme.text,
      fontSize: 30,
      fontWeight: '600',
      lineHeight: 35,
      letterSpacing: -1.2,
    },
    subtitle: {
      color: theme.textMuted,
      fontSize: 16,
      lineHeight: 22,
      marginTop: 12,
      maxWidth: 260,
    },
    updatedText: {
      color: theme.textMuted,
      fontSize: 14,
      fontWeight: '700',
      marginTop: 8,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingTop: 2,
    },
    headerButton: {
      width: 52,
      height: 52,
      borderRadius: 18,
      backgroundColor: theme.card,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addHeaderButton: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
      shadowColor: theme.primary,
      shadowOpacity: 0.25,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
    },
    addMiniBadge: {
      position: 'absolute',
      top: 8,
      right: 7,
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: 'rgba(255,255,255,0.28)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    walletCard: {
      backgroundColor: theme.card,
      borderRadius: 28,
      paddingHorizontal: 18,
      paddingVertical: 18,
      marginBottom: 18,
      borderWidth: 1,
      borderColor: theme.border,
      shadowColor: '#000',
      shadowOpacity: 0.04,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
    },
    walletTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 10,
    },
    walletLeft: {
      flex: 1,
      paddingRight: 8,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    walletName: {
      color: theme.text,
      fontSize: 25,
      fontWeight: '600',
      letterSpacing: -0.5,
      flexShrink: 1,
    },
    nameActions: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 0,
    },
    inlineIconButton: {
      width: 22,
      height: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
    },
    walletAddress: {
      color: theme.textMuted,
      fontSize: 16,
      fontWeight: '600',
    },
    copyButton: {
      marginLeft: 8,
      width: 26,
      height: 26,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pnlBlock: {
      alignItems: 'flex-end',
      minWidth: 112,
    },
    pnlValue: {
      fontSize: 25,
      fontWeight: '600',
      letterSpacing: -0.4,
    },
    roiValue: {
      fontSize: 18,
      fontWeight: '700',
      marginTop: 4,
    },
    badgeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 9,
      marginTop: 20,
      marginBottom: 16,
    },
    badge: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 5,
      paddingVertical: 3,
    },
    badgeText: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    longBadge: {
      borderColor: theme.green,
      backgroundColor: theme.greenBg,
    },
    shortBadge: {
      borderColor: theme.red,
      backgroundColor: theme.redBg,
    },
    longText: {
      color: theme.green,
    },
    shortText: {
      color: theme.red,
    },
    divider: {
      height: 1,
      backgroundColor: theme.border,
      marginBottom: 12,
    },
    footerStats: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    footerStat: {
      color: theme.textMuted,
      fontSize: 15,
      fontWeight: '700',
    },
    footerStatStrong: {
      fontSize: 15,
      fontWeight: '700',
    },
    green: {
      color: theme.green,
    },
    red: {
      color: theme.red,
    },
    emptyCard: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.card,
      borderRadius: 28,
      padding: 26,
      alignItems: 'center',
      marginBottom: 18,
    },
    emptyTitle: {
      color: theme.text,
      fontSize: 22,
      fontWeight: '700',
      marginTop: 14,
    },
    emptyHint: {
      color: theme.textMuted,
      textAlign: 'center',
      fontSize: 15,
      lineHeight: 21,
      marginTop: 8,
    },
    
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
    },
    modalCard: {
      backgroundColor: theme.background,
      borderTopLeftRadius: 30,
      borderTopRightRadius: 30,
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 32,
    },
    modalTitle: {
      color: theme.text,
      fontSize: 26,
      fontWeight: '900',
      marginBottom: 18,
    },
    inputLabel: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '700',
      marginBottom: 8,
    },
    input: {
      backgroundColor: theme.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.border,
      color: theme.text,
      paddingHorizontal: 16,
      paddingVertical: 15,
      fontSize: 16,
      marginBottom: 16,
    },
    primaryButton: {
      backgroundColor: theme.primary,
      borderRadius: 18,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 4,
    },
    primaryButtonText: {
      color: '#fff',
      fontSize: 17,
      fontWeight: '900',
    },
    cancelButton: {
      alignItems: 'center',
      paddingVertical: 16,
      marginTop: 4,
    },
    cancelButtonText: {
      color: theme.textMuted,
      fontSize: 16,
      fontWeight: '700',
    },
  });
