import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { getAuthCallbackRedirectUri } from '@/src/auth/googleOAuth';
import { useAuthStore } from '@/src/stores/authStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: Spacing.xl,
    },
    header: {
      alignSelf: 'stretch',
      alignItems: 'center',
      marginBottom: Spacing.xl,
    },
    logo: {
      width: 240,
      height: 240,
      marginBottom: Spacing.sm,
    },
    subtitle: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      marginTop: Spacing.xs,
    },
    form: {
      gap: Spacing.md,
    },
    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      marginVertical: Spacing.sm,
    },
    dividerLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    dividerText: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
    },
    googleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.lg,
      paddingHorizontal: Spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    googleButtonText: {
      color: colors.text,
      fontSize: FontSize.md,
      fontWeight: '600',
    },
    appleButton: {
      width: '100%',
      height: 48,
    },
    input: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      fontSize: FontSize.md,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
    },
    error: {
      color: colors.error,
      fontSize: FontSize.sm,
      textAlign: 'center',
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      padding: Spacing.lg,
      alignItems: 'center',
      marginTop: Spacing.sm,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonText: {
      color: colors.textInverse,
      fontSize: FontSize.lg,
      fontWeight: '700',
    },
    switchButton: {
      alignItems: 'center',
      padding: Spacing.md,
    },
    switchText: {
      color: colors.primary,
      fontSize: FontSize.md,
    },
    forgotButton: {
      alignSelf: 'flex-end',
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.xs,
    },
    forgotText: {
      color: colors.primary,
      fontSize: FontSize.sm,
      fontWeight: '600',
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      padding: Spacing.lg,
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
      gap: Spacing.md,
    },
    modalTitle: {
      fontSize: FontSize.lg,
      fontWeight: '700',
      color: colors.text,
    },
    modalBody: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    modalLink: {
      fontSize: FontSize.sm,
      color: colors.primary,
      fontWeight: '600',
      textDecorationLine: 'underline',
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: Spacing.md,
      marginTop: Spacing.sm,
    },
    modalSecondary: {
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
    },
    modalSecondaryText: {
      color: colors.textSecondary,
      fontSize: FontSize.md,
    },
    devRedirectHint: {
      fontSize: 11,
      color: colors.textTertiary,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
      marginTop: Spacing.sm,
    },
  });
}

export default function AuthScreen() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [forgotModalVisible, setForgotModalVisible] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetBanner, setResetBanner] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const { signIn, signUp, signInWithGoogle, signInWithApple, requestPasswordReset } = useAuthStore();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    void AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);

    try {
      if (isSignUp) {
        const result = await signUp(email, password, displayName || 'Angler');
        if (result.error) setError(result.error);
      } else {
        const result = await signIn(email, password);
        if (result.error) setError(result.error);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const result = await signInWithGoogle();
      if (result.error) setError(result.error);
    } catch {
      setError('Google sign-in failed. Please try again.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleApple = async () => {
    if (appleLoading || googleLoading || loading) return;
    setError(null);
    setAppleLoading(true);
    try {
      const result = await signInWithApple();
      if (result.error) setError(result.error);
    } catch {
      setError('Sign in with Apple failed. Please try again.');
    } finally {
      setAppleLoading(false);
    }
  };

  const openForgotModal = () => {
    setResetError(null);
    setResetBanner(null);
    setResetEmail(email.trim().includes('@') ? email.trim() : '');
    setForgotModalVisible(true);
  };

  const closeForgotModal = () => {
    setForgotModalVisible(false);
    setResetLoading(false);
    setResetError(null);
  };

  const handleSendReset = async () => {
    setResetError(null);
    setResetBanner(null);
    setResetLoading(true);
    try {
      const result = await requestPasswordReset(resetEmail);
      if (result.error) {
        setResetError(result.error);
      } else {
        setResetBanner(
          'If an account exists for that email, we sent a reset link. Check your inbox and spam folder.',
        );
      }
    } catch {
      setResetError('Something went wrong. Please try again.');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Image
              source={require('@/assets/images/logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.subtitle}>Your AI fishing companion</Text>
          </View>

          <View style={styles.form}>
            {Platform.OS === 'ios' && appleAvailable ? (
              <View style={[appleLoading && styles.buttonDisabled]}>
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
                  cornerRadius={BorderRadius.md}
                  style={styles.appleButton}
                  onPress={handleApple}
                />
              </View>
            ) : null}

            <Pressable
              style={[
                styles.googleButton,
                (loading || googleLoading || appleLoading) && styles.buttonDisabled,
              ]}
              onPress={handleGoogle}
              disabled={loading || googleLoading || appleLoading}
            >
              {googleLoading ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              )}
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {isSignUp && (
              <TextInput
                style={styles.input}
                placeholder="Display Name"
                placeholderTextColor={colors.textTertiary}
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
              />
            )}
            <TextInput
              style={styles.input}
              placeholder={isSignUp ? 'Email' : 'Email or username'}
              placeholderTextColor={colors.textTertiary}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={isSignUp ? 'email-address' : 'default'}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.textTertiary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            {!isSignUp ? (
              <Pressable style={styles.forgotButton} onPress={openForgotModal}>
                <Text style={styles.forgotText}>Forgot password?</Text>
              </Pressable>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[styles.button, (loading || googleLoading || appleLoading) && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={loading || googleLoading || appleLoading}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
              </Text>
            </Pressable>

            <Pressable
              style={styles.switchButton}
              onPress={() => {
                setIsSignUp(!isSignUp);
                setError(null);
              }}
            >
              <Text style={styles.switchText}>
                {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={forgotModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeForgotModal}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeForgotModal} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ width: '100%', maxWidth: 400, zIndex: 1 }}
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Reset password</Text>
              <Text style={styles.modalBody}>
                For accounts that use email and a DriftGuide password, we can send a reset link. If you
                usually sign in with Google or Apple, DriftGuide does not store a separate password—use
                your Google or Apple account recovery instead.
              </Text>
            <TextInput
              style={styles.input}
              placeholder="Your account email"
              placeholderTextColor={colors.textTertiary}
              value={resetEmail}
              onChangeText={setResetEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            {resetBanner ? <Text style={[styles.modalBody, { color: colors.text }]}>{resetBanner}</Text> : null}
            {resetError ? <Text style={styles.error}>{resetError}</Text> : null}
            <Pressable
              style={[styles.button, resetLoading && styles.buttonDisabled]}
              onPress={handleSendReset}
              disabled={resetLoading}
            >
              <Text style={styles.buttonText}>
                {resetLoading ? 'Please wait…' : 'Send reset link'}
              </Text>
            </Pressable>
            <Text style={styles.modalBody}>Provider account recovery:</Text>
            <Pressable onPress={() => void Linking.openURL('https://accounts.google.com/signin/recovery')}>
              <Text style={styles.modalLink}>Google account help</Text>
            </Pressable>
            <Pressable onPress={() => void Linking.openURL('https://iforgot.apple.com/')}>
              <Text style={styles.modalLink}>Apple ID account help</Text>
            </Pressable>
            {__DEV__ ? (
              <View style={{ marginTop: Spacing.md, gap: Spacing.xs }}>
                <Text style={[styles.modalBody, { fontWeight: '600', color: colors.text }]}>
                  Expo Go / dev testing
                </Text>
                <Text style={styles.modalBody}>
                  1. Copy the URL below into Supabase → Authentication → Redirect URLs (exact match).
                </Text>
                <Text style={styles.modalBody}>
                  2. On a real phone, avoid localhost: run{' '}
                  <Text style={{ fontWeight: '700' }}>npx expo start --tunnel</Text> then resend the reset
                  email so the link opens Expo Go.
                </Text>
                <Text selectable style={styles.devRedirectHint}>
                  {getAuthCallbackRedirectUri()}
                </Text>
              </View>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable style={styles.modalSecondary} onPress={closeForgotModal}>
                <Text style={styles.modalSecondaryText}>Close</Text>
              </Pressable>
            </View>
          </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
