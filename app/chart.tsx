import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { Stack, useLocalSearchParams } from 'expo-router';

export default function ChartScreen() {
  const { coin } = useLocalSearchParams();

  const symbol = String(coin || 'BTC').toUpperCase();

  const html = `
  <!DOCTYPE html>
  <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        html, body {
          margin: 0;
          padding: 0;
          background: #0f172a;
          overflow: hidden;
        }

        #tradingview_chart {
          height: 100vh;
          width: 100vw;
        }
      </style>
    </head>

    <body>
      <div id="tradingview_chart"></div>

      <script src="https://s3.tradingview.com/tv.js"></script>

      <script>
        new TradingView.widget({
          autosize: true,
          symbol: "BINANCE:${symbol}USDT",
          interval: "60",
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          toolbar_bg: "#0f172a",
          enable_publishing: false,
          hide_top_toolbar: false,
          hide_side_toolbar: false,
          allow_symbol_change: true,
          container_id: "tradingview_chart"
        });
      </script>
    </body>
  </html>
  `;

  return (
    <>
      <Stack.Screen
  options={{
    title: '',
    headerTransparent: true,
    headerTintColor: '#ffffff',
  }}
/>
      <SafeAreaView style={styles.container}>
        <WebView
          source={{ html }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
        />
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  
});