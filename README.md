# Audio Encryptor/Decryptor with RGB Image Steganography

This web application allows you to encrypt audio recordings or files and embed them into the pixel data of a PNG image. You can then decrypt these images back into playable audio, all within your browser using client-side JavaScript.

The security of the audio relies on AES-GCM encryption, with the key derived from a user-provided passphrase using PBKDF2.

## Features

*   **Record Audio:** Directly record audio from your microphone.
*   **Encrypt Audio:** Encrypts recorded audio using AES-GCM.
*   **Embed in Image:** Embeds the encrypted audio data (including salt, IV, and metadata like sample rate) into the RGB channels of a dynamically generated PNG image.
*   **Password Protection:** Uses a user-provided secret key (passphrase) for encryption and decryption.
*   **Password Strength Indicator:** Provides feedback on the strength of the chosen secret key.
*   **Decrypt from Image:** Load an encrypted PNG image to decrypt the audio.
*   **Playback:** Play the decrypted audio directly in the browser.
*   **Save Encrypted Image:** Download the generated PNG image containing the encrypted audio.
*   **Save Decrypted Audio:** Download the decrypted audio as a `.wav` file.
*   **File Upload:** Supports uploading existing encrypted PNG images (via browse or drag-and-drop).
*   **Client-Side Operations:** All encryption, decryption, and processing happen locally in the user's browser. No data is sent to a server.

## How It Works

### Encryption Process:

1.  **Audio Input:** Audio is captured either from the microphone (recorded as `AudioBuffer`) or from a source that can be converted to an `AudioBuffer`.
2.  **Secret Key:** The user provides a secret key (passphrase).
3.  **Key Derivation (PBKDF2):**
    *   A random `salt` (16 bytes) is generated.
    *   The `salt` and the user's passphrase are used with PBKDF2 (SHA-256, 100,000 iterations) to derive a 256-bit AES key.
4.  **Encryption (AES-GCM):**
    *   A random Initialization Vector (`IV` - 12 bytes) is generated.
    *   The raw audio data (as a `Float32Array` buffer) is encrypted using AES-256-GCM with the derived key and IV. AES-GCM provides both confidentiality and authenticity.
5.  **Payload Assembly:**
    *   A header is constructed containing:
        *   `Salt` (16 bytes)
        *   `IV` (12 bytes)
        *   `Ciphertext Length` (4 bytes, Uint32) - The length of the encrypted audio data.
        *   `Sample Rate` (4 bytes, Uint32) - The original sample rate of the audio.
    *   The final payload is: `[Header | Encrypted Audio Data]`
6.  **Image Encoding:**
    *   The total number of bytes in the payload determines the minimum number of pixels needed (since 3 bytes of data are stored per pixel: R, G, B).
    *   A canvas is created with dimensions sufficient to hold the data.
    *   The bytes from the payload are written sequentially into the R, G, and B channels of the image's pixel data. The Alpha channel is set to 255 (fully opaque).
    *   Any remaining pixel data (if the image is larger than needed) is padded with zeros for RGB.
7.  **Output:** The canvas is displayed to the user and can be saved as a PNG image.

### Decryption Process:

1.  **Image Input:** The user uploads an encrypted PNG image.
2.  **Secret Key:** The user provides the *same* secret key used for encryption.
3.  **Data Extraction:**
    *   The image is drawn onto a canvas.
    *   The R, G, and B values from each pixel are extracted sequentially to reconstruct the byte payload.
4.  **Header Parsing:**
    *   The first `HEADER_LENGTH` bytes of the extracted payload are parsed to retrieve:
        *   `Salt`
        *   `IV`
        *   `Ciphertext Length`
        *   `Sample Rate`
5.  **Key Derivation (PBKDF2):**
    *   The *extracted* `salt` and the user's passphrase are used with PBKDF2 to re-derive the AES key.
6.  **Decryption (AES-GCM):**
    *   The encrypted audio data (identified by `Ciphertext Length`) is decrypted using AES-256-GCM with the derived key and the *extracted* `IV`.
7.  **Audio Reconstruction:**
    *   The decrypted bytes are converted back into a `Float32Array`.
    *   An `AudioBuffer` is created using this data and the *extracted* `Sample Rate`.
8.  **Output:** The `AudioBuffer` can be played back or saved as a WAV file.

## Requirements

*   A modern web browser that supports:
    *   Web Crypto API (`crypto.subtle`)
    *   MediaDevices API (`navigator.mediaDevices.getUserMedia`) for recording
    *   `AudioContext`
    *   HTML5 Canvas

## Getting Started / How to Use

1.  **Open the Application:** Simply open the `index.html` file in a compatible web browser.
2.  **Enter Secret Key:** Type a strong, memorable secret key into the "Enter Strong Secret Key" field. Pay attention to the password strength indicator. **This key is crucial; if you lose it, you cannot decrypt the audio.**
3.  **To Encrypt Audio:**
    *   Click the `<i class="fas fa-microphone"></i> Record` button.
    *   Allow microphone access if prompted by the browser.
    *   Speak or play audio into your microphone.
    *   Click the `<i class="fas fa-microphone-slash"></i> Stop Recording` button.
    *   An image representing the encrypted audio will appear in the display area.
    *   Optionally, click `<i class="fas fa-download"></i> Save Image` to download the encrypted PNG file.
4.  **To Decrypt Audio:**
    *   Ensure the **correct secret key** (the one used for encryption) is entered.
    *   **Load Encrypted Image:**
        *   Click the `<i class="fas fa-paperclip"></i> Browse` button and select your encrypted PNG file.
        *   Or, drag and drop the encrypted PNG file onto the image display area.
    *   The image will appear in the display area.
    *   Click the `<i class="fas fa-lock-open"></i> Decrypt` button (it changes to "Decrypt & Play" when ready).
    *   If successful, the audio will start playing. An audio player will appear.
    *   Optionally, click `<i class="fas fa-file-audio"></i> Save Audio` to download the decrypted audio as a `.wav` file.

## Security Considerations

*   **Secret Key Strength:** The entire security of your encrypted audio depends on the strength and secrecy of your chosen key. Use a long, complex, and unique passphrase.
*   **Key Management:** This application does **not** store your secret key. You are responsible for remembering it. If you forget the key, the encrypted audio is irrecoverable.
*   **Client-Side Only:** All operations are performed in your browser. Your audio data and secret key are not sent to any server.
*   **AES-GCM:** This mode provides authenticated encryption, meaning it protects against both eavesdropping and tampering (it detects if the ciphertext has been modified).
*   **PBKDF2:** Using PBKDF2 for key derivation makes brute-forcing the passphrase significantly harder by adding computational cost.
*   **Steganography Aspect:** While encrypted, the fact that data is hidden within an image is a form of steganography. The resulting image will look like random noise, which itself might attract attention. This tool prioritizes secure embedding over making the image look "normal".
*   **No Anonymity:** This tool does not provide anonymity.

## Limitations

*   **File Size:** Very long audio recordings will result in very large image files. Browsers may have limitations on handling extremely large canvas elements or data URLs.
*   **Performance:** Encryption and decryption of very large audio files can be CPU-intensive and may take some time, as all processing is done client-side.
*   **Browser Compatibility:** Relies on modern browser features. Performance and compatibility may vary between browsers.
*   **Visual Appearance:** The generated PNG image will appear as random-looking colored pixels, not a visually coherent image. It's obviously not a typical photograph.

## Disclaimer

This tool is provided as-is, without any warranty. While it uses strong cryptographic primitives, always exercise caution when handling sensitive information. You are solely responsible for the security of your secret keys and the data you encrypt. For highly sensitive information, consider professionally audited and dedicated encryption software.