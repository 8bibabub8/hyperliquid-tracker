import { Ionicons } from '@expo/vector-icons';
import { darkTheme, lightTheme } from '../../theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';

const REGISTER_WALLET_URL =
  'https://cvdnudenzjooginvgbnt.supabase.co/functions/v1/register-wallet';

function formatUSD(value: string) {
  const num = Number(value);
  if (isNaN(num)) return '$0';

  return '$' + num.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

type WalletData = {
  name: string;
  address: string;
  accountValue: string;
  positions: number;
  pnl: number;
};

const STORAGE_KEY = 'tracked_wallets';

async function getExpoPushToken() {
  if (!Device.isDevice) {
    console.log('Push Notifications funktionieren nur auf echtem Gerät.');
    return null;
  }

  const { status: existingStatus } =
    await Notifications.getPermissionsAsync();

  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Keine Push-Berechtigung.');
    return null;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  return tokenData.data;
}

async function registerWalletForPush(address: string, name: string) {
  try {
    const pushToken = await getExpoPushToken();

    if (!pushToken) return;

    const response = await fetch(REGISTER_WALLET_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pushToken,
        address,
        name,
        platform: Platform.OS,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.log('register-wallet error:', data);
      return;
    }

    console.log('Wallet registered for push:', data);
  } catch (error) {
    console.log('registerWalletForPush failed:', error);
  }
}

export default function HomeScreen() {
  const [wallet, setWallet] = useState('');
  const [walletName, setWalletName] = useState('');
  const [wallets, setWallets] = useState<WalletData[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('Noch nie');
  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(false);

  const theme = isDarkMode ? darkTheme : lightTheme;
  const styles = createStyles(theme);

  useEffect(() => {
    const loadSavedWallets = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);

        if (saved) {
          const parsedWallets = JSON.parse(saved);

          const normalizedWallets = parsedWallets.map((item: any) => ({
            name: item.name ?? 'Unbenannte Wallet',
            address: item.address ?? '',
            accountValue: item.accountValue ?? '0',
            positions: item.positions ?? 0,
            pnl: item.pnl ?? 0,
          }));

          setWallets(normalizedWallets);
        }
      } catch (error) {
        console.error('Fehler beim Laden der Wallets:', error);
      }
    };

    loadSavedWallets();
  }, []);

  useEffect(() => {
    const saveWallets = async () => {
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
      } catch (error) {
        console.error('Fehler beim Speichern der Wallets:', error);
      }
    };

    saveWallets();
  }, [wallets]);

  const removeWallet = (addressToRemove: string) => {
    setWallets((prev) => prev.filter((item) => item.address !== addressToRemove));
  };

  const startRenameWallet = (address: string, currentName: string) => {
    setEditingAddress(address);
    setEditingName(currentName);
  };

  const saveRenamedWallet = (address: string) => {
    const cleanName = editingName.trim() || 'Unbenannte Wallet';

    setWallets((prev) =>
      prev.map((item) =>
        item.address === address ? { ...item, name: cleanName } : item
      )
    );

    setEditingAddress(null);
    setEditingName('');
  };

  const loadWallet = async () => {
    const cleanWallet = wallet.trim();

    if (!cleanWallet) {
      Alert.alert('Hinweis', 'Bitte eine Wallet-Adresse eingeben.');
      return;
    }

    const alreadyExists = wallets.some(
      (item) => item.address.toLowerCase() === cleanWallet.toLowerCase()
    );

    if (alreadyExists) {
      Alert.alert('Schon vorhanden', 'Diese Wallet ist bereits in deiner Liste.');
      return;
    }

    try {
      setLoading(true);

      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'clearinghouseState',
          user: cleanWallet,
        }),
      });

      const data = await response.json();

      if (!data || data.error) {
        Alert.alert(
          'Keine Daten gefunden',
          'Für diese Adresse wurden keine Perps-Account-Daten gefunden.'
        );
        return;
      }

      const accountValue = data?.marginSummary?.accountValue ?? '0';
      const positions = data?.assetPositions?.length ?? 0;

      const fakePnl = (Math.random() - 0.5) * 1000;

      const newWallet: WalletData = {
        name: walletName.trim() || 'Unbenannte Wallet',
        address: cleanWallet,
        accountValue,
        positions,
        pnl: fakePnl,
      };

      setWallets((prev) => [newWallet, ...prev]);
      await registerWalletForPush(cleanWallet, walletName);
      setWallet('');
      setWalletName('');
    } catch (error) {
      console.error(error);
      Alert.alert(
        'Fehler',
        'Die Daten konnten nicht geladen werden. Prüfe die Wallet-Adresse und deine Internetverbindung.'
      );
    } finally {
      setLoading(false);
    }
  };

  const refreshAllWallets = async () => {
    if (wallets.length === 0) return;

    try {
      setIsRefreshingAll(true);

      const updatedWallets = await Promise.all(
        wallets.map(async (w) => {
          try {
            const response = await fetch('https://api.hyperliquid.xyz/info', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                type: 'clearinghouseState',
                user: w.address,
              }),
            });

            const data = await response.json();

            if (!data || data.error) return w;

            const accountValue =
              data?.marginSummary?.accountValue ?? w.accountValue;

            const positions =
              data?.assetPositions?.length ?? w.positions;

            return {
              ...w,
              accountValue,
              positions,
            };
          } catch (error) {
            console.error('Fehler bei Wallet:', w.address, error);
            return w;
          }
        })
      );

      setWallets(updatedWallets);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (error) {
      console.error('Fehler beim Aktualisieren:', error);
      Alert.alert('Fehler', 'Die Wallets konnten nicht aktualisiert werden.');
    } finally {
      setIsRefreshingAll(false);
    }
  };

  useEffect(() => {
    if (wallets.length === 0) return;

    const interval = setInterval(() => {
      refreshAllWallets();
    }, 30000);

    return () => clearInterval(interval);
  }, [wallets.length]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Hyperliquid Tracker</Text>

          <View style={styles.headerButtons}>
            <TouchableOpacity
              activeOpacity={0.7}
              style={[
  styles.themeButton,
  isDarkMode ? styles.themeButtonActive : null,
]}
              onPress={() => setIsDarkMode((prev) => !prev)}
            >
<Ionicons
  name={isDarkMode ? 'sunny' : 'moon'}
  size={20}
  color={isDarkMode ? '#fff' : theme.text}
/>
              
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.refreshButton}
              onPress={refreshAllWallets}
              disabled={isRefreshingAll}
            >
              <Text style={styles.refreshText}>
                {isRefreshingAll ? '...' : '↻'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.subtitle}>
          Tracke öffentliche Wallets und ihre Aktivitäten.
        </Text>

        <Text style={styles.lastUpdatedText}>
          Zuletzt aktualisiert: {lastUpdated}
        </Text>

        <View style={styles.inputCard}>
          <Text style={styles.label}>Wallet-Name</Text>
          <TextInput
            style={styles.input}
            placeholder="z. B. Whale BTC"
            placeholderTextColor={theme.textMuted}
            value={walletName}
            onChangeText={setWalletName}
          />

          <Text style={styles.label}>Wallet-Adresse</Text>
          <TextInput
            style={styles.input}
            placeholder="0x..."
            placeholderTextColor={theme.textMuted}
            value={wallet}
            onChangeText={setWallet}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={loadWallet}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Lade...' : 'Track wallet'}
            </Text>
          </TouchableOpacity>
        </View>

        {wallets.map((w, index) => {
          const isProfit = w.pnl >= 0;

          return (
            <TouchableOpacity
              key={`${w.address}-${index}`}
              style={styles.walletCard}
              onPress={() =>
                router.push({
                  pathname: '/wallet-details',
                  params: {
                    address: w.address,
                    name: w.name,
                    themeMode: isDarkMode ? 'dark' : 'light',
                  },
                })
              }
            >
              <View style={styles.walletHeader}>
                <View style={styles.walletTitleArea}>
                  {editingAddress === w.address ? (
                    <TextInput
                      style={styles.renameInput}
                      value={editingName}
                      onChangeText={setEditingName}
                      placeholder="Neuer Name"
                      placeholderTextColor={theme.textMuted}
                    />
                  ) : (
                    <Text style={styles.walletName}>
                      {w.name?.trim() || 'Unbenannte Wallet'}
                    </Text>
                  )}
                </View>

                <View style={styles.walletHeaderRight}>
                  <Text style={[styles.pnl, isProfit ? styles.green : styles.red]}>
                    {isProfit ? '+' : ''}
                    {w.pnl.toFixed(2)}$
                  </Text>

                  {editingAddress === w.address ? (
                    <TouchableOpacity
                      style={styles.renameButton}
                      onPress={() => saveRenamedWallet(w.address)}
                    >
                      <Text style={styles.renameButtonText}>Save</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.renameButton}
                      onPress={() =>
                        startRenameWallet(
                          w.address,
                          w.name?.trim() || 'Unbenannte Wallet'
                        )
                      }
                    >
                      <Text style={styles.renameButtonText}>Rename</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => removeWallet(w.address)}
                  >
                    <Text style={styles.deleteButtonText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={styles.walletAddress}>{w.address}</Text>

              <View style={styles.row}>
                <View style={styles.box}>
                  <Text style={styles.labelSmall}>Equity</Text>
                  <Text style={styles.valueBig}>{formatUSD(w.accountValue)}</Text>
                </View>

                <View style={styles.box}>
                  <Text style={styles.labelSmall}>Positions</Text>
                  <Text style={styles.valueBig}>{w.positions}</Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (theme: typeof darkTheme) =>
  StyleSheet.create({
   themeButtonActive: {
  backgroundColor: theme.primary,
},
    
    safeArea: {
      flex: 1,
      backgroundColor: theme.background,
    },
    container: {
      padding: 20,
      paddingBottom: 40,
    },
    title: {
      fontSize: 28,
      color: theme.text,
      fontWeight: 'bold',
    },
    subtitle: {
      color: theme.textMuted,
      marginBottom: 8,
    },
    lastUpdatedText: {
      color: theme.textMuted,
      fontSize: 12,
      marginTop: 6,
      marginBottom: 16,
    },
    inputCard: {
      backgroundColor: theme.card,
      padding: 16,
      borderRadius: 16,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: theme.border,
    },
    label: {
      color: theme.text,
      marginBottom: 8,
    },
    input: {
      backgroundColor: theme.cardSecondary,
      color: theme.text,
      padding: 12,
      borderRadius: 10,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: theme.border,
    },
    button: {
      backgroundColor: theme.primary,
      padding: 12,
      borderRadius: 10,
      alignItems: 'center',
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonText: {
      color: '#ffffff',
      fontWeight: 'bold',
    },
    walletCard: {
      backgroundColor: theme.card,
      padding: 16,
      borderRadius: 16,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: theme.border,
    },
    walletHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    walletTitleArea: {
      flex: 1,
      marginRight: 12,
    },
    walletName: {
      color: theme.text,
      fontSize: 18,
      fontWeight: 'bold',
    },
    walletAddress: {
      color: theme.textMuted,
      marginBottom: 10,
      marginTop: 4,
    },
    pnl: {
      fontSize: 16,
      fontWeight: 'bold',
    },
    green: {
      color: theme.green,
    },
    red: {
      color: theme.red,
    },
    row: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 10,
    },
    box: {
      flex: 1,
      backgroundColor: theme.cardSecondary,
      padding: 12,
      borderRadius: 12,
    },
    labelSmall: {
      color: theme.textMuted,
      fontSize: 12,
    },
    valueBig: {
      color: theme.text,
      fontSize: 18,
      fontWeight: 'bold',
    },
    walletHeaderRight: {
      alignItems: 'flex-end',
      gap: 8,
    },
    deleteButton: {
      backgroundColor: theme.redBg,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 10,
    },
    deleteButtonText: {
      color: theme.redSoft,
      fontSize: 12,
      fontWeight: 'bold',
    },
    renameInput: {
      backgroundColor: theme.cardSecondary,
      color: theme.text,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      fontSize: 16,
      fontWeight: 'bold',
    },
    renameButton: {
      backgroundColor: theme.blueBg,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 10,
    },
    renameButtonText: {
      color: theme.primarySoft,
      fontSize: 12,
      fontWeight: 'bold',
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    headerButtons: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    refreshButton: {
      backgroundColor: theme.card,
      padding: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
    },
    refreshText: {
      color: theme.primarySoft,
      fontSize: 18,
      fontWeight: 'bold',
    },
    themeButton: {
      backgroundColor: theme.card,
      padding: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
    },
    themeButtonText: {
      fontSize: 18,
    },
  });