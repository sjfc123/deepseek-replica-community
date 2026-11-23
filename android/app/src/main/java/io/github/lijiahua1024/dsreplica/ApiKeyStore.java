package io.github.lijiahua1024.dsreplica;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class ApiKeyStore {
    private static final String KEY_ALIAS = "deepseek-api-key";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_LENGTH = 12;
    private final SharedPreferences preferences;
    private final String preference;

    ApiKeyStore(Context context) {
        this(context, "encrypted");
    }

    ApiKeyStore(Context context, String preference) {
        preferences = context.getSharedPreferences("credentials", Context.MODE_PRIVATE);
        this.preference = preference;
    }

    String read() {
        String stored = preferences.getString(preference, null);
        if (stored == null) return null;
        try {
            byte[] bytes = Base64.decode(stored, Base64.NO_WRAP);
            if (bytes.length <= IV_LENGTH) return null;
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, bytes, 0, IV_LENGTH));
            return new String(cipher.doFinal(bytes, IV_LENGTH, bytes.length - IV_LENGTH),
                StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException | java.io.IOException ignored) {
            return null;
        }
    }

    boolean write(String value) {
        if (value == null || value.isEmpty()) {
            return preferences.edit().remove(preference).commit();
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = cipher.getIV();
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] bytes = Arrays.copyOf(iv, iv.length + encrypted.length);
            System.arraycopy(encrypted, 0, bytes, iv.length, encrypted.length);
            return preferences.edit().putString(preference, Base64.encodeToString(bytes, Base64.NO_WRAP))
                .commit();
        } catch (GeneralSecurityException | java.io.IOException ignored) {
            return false;
        }
    }

    private SecretKey key() throws GeneralSecurityException, java.io.IOException {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.getKey(KEY_ALIAS, null) instanceof SecretKey existing) return existing;

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }
}
