// --- Global Constants and Variables ---

// Removed: const SECRET_KEY = "mySuperSecretKey123";
// The secret key will now be fetched from the user input field.

/**
 * @type {Object|null} mediaRecorderInstance
 * Holds the instance of the custom audio capture object returned by `captureAudio()`.
 * This object contains methods like `stop()` to finish recording and `audioContext` for the
 * recording session. It's null when no recording is active.
 */
let mediaRecorderInstance = null;

/**
 * @type {number} lastRecordedSampleRate
 * Stores the sample rate of the most recently recorded audio.
 * This is crucial for accurately reconstructing the audio during decryption, ensuring it plays
 * back at the correct speed and pitch. Defaults to 44100 Hz.
 */
let lastRecordedSampleRate = 44100;

/**
 * @type {AudioContext|null} globalPlaybackContext
 * Manages the Web Audio API AudioContext used for playing back the decrypted audio.
 * This context is created or resumed as needed to ensure audio can play, especially considering
 * browser autoplay policies that require user interaction. It's null initially.
 */
let globalPlaybackContext = null;

// --- SVG Icons (for UI buttons) ---
const MIC_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: middle; margin-right: 5px;"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15a1 1 0 0 0-.98-.85c-.61 0-1.09.54-1 1.14.49 3.17 2.98 5.71 6 5.71s5.51-2.54 6-5.71c.09-.6-.39-1.14-1-1.14z"/><path d="M12 19c-1.18 0-2.34-.21-3.43-.63-.43-.16-.66-.63-.49-1.06.16-.43.63-.66 1.06-.49C10.22 17.2 11.08 17 12 17s1.78.2 2.85.87c.43.16.66-.63.49 1.06-.16-.43-.63.66-1.06-.49A5.99 5.99 0 0 1 12 19z"/></svg>`;
const STOP_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: middle; margin-right: 5px;"><path d="M6 6h12v12H6z"/></svg>`;

// --- Secret Key Management ---
/**
 * Retrieves the secret key from the user input field.
 * @returns {string|null} The user-entered secret key, or null if the input field is not found.
 *                        The string can be empty if the user hasn't typed anything.
 */
function getUserSecretKey() {
    const keyInput = document.getElementById('secret-key-input');
    if (!keyInput) {
        console.error("Secret key input field ('secret-key-input') not found!");
        alert("Error: Secret key input field is missing from the page. Please contact support or refresh.");
        return null;
    }
    return keyInput.value;
}

// --- Pseudo-Random Number Generator (PRNG) Functions ---

/**
 * Creates a numeric seed from a string.
 * @param {string} str - The input string (e.g., user-defined secret key).
 * @returns {number} A numeric seed. Returns 0 if the input string is null or empty.
 */
function createSeedFromString(str) {
    if (!str) return 0;
    let seed = 0;
    for (let i = 0; i < str.length; i++) {
        seed = (seed + str.charCodeAt(i)) % 0x7FFFFFFF;
    }
    return seed;
}

/**
 * A simple Linear Congruential Generator (LCG) for pseudo-random number generation.
 * @param {number} seed - The initial seed value.
 * @returns {function} A function that returns the next pseudo-random number (0-1).
 */
function seededPRNG(seed) {
    let state = seed;
    const m = 0x80000000;
    const a = 1103515245;
    const c = 12345;
    return function next() {
        state = (a * state + c) % m;
        return state / m;
    };
}

// --- UI Helper Functions ---

/**
 * Updates the content of the waveform display area with a message.
 * @param {HTMLElement} element - The HTML element to update.
 * @param {string} message - The message text to display.
 * @param {string} [color='#777'] - The CSS color for the message text.
 */
function updateWaveformMessage(element, message, color = '#777') {
    if (element) {
        // Keep padding if message is short, otherwise remove it for more space
        const usePadding = message.length < 100; 
        element.innerHTML = `<p style="color:${color}; text-align: center; ${usePadding ? 'padding-top: 80px;' : ''}">${message}</p>`;
    }
}

// --- Core Encryption and Decryption Logic ---

/**
 * "Encrypts" an AudioBuffer into a visual image on a canvas.
 * @param {AudioBuffer} audioBuffer - The audio data to encrypt.
 * @param {HTMLElement} displayElement - The HTML element where the canvas will be displayed.
 * @returns {HTMLCanvasElement|null} The canvas element, or null on failure.
 */
function encryptAudioToImage(audioBuffer, displayElement) {
    const userKey = getUserSecretKey();
    if (userKey === null) return null; // Error handled by getUserSecretKey already
    if (userKey.trim() === '') {
        updateWaveformMessage(displayElement, 'Error: Secret Key is required to encrypt audio. Please enter a key.', '#ff6b6b');
        console.error("Encryption halted: Secret Key is missing.");
        return null;
    }

    if (!displayElement) {
        console.error('Error: Display element for encrypted pattern not provided.');
        alert('Encryption Error: Display element missing.');
        return null;
    }
    // displayElement.innerHTML = ''; // Clear existing content - will be replaced by canvas or new message

    if (!audioBuffer) {
        console.error("No audio buffer to encrypt.");
        updateWaveformMessage(displayElement, 'Error: No audio data available to encrypt.', '#ff6b6b');
        return null;
    }
    const channelData = audioBuffer.getChannelData(0);
    const numSamples = channelData.length;

    if (numSamples === 0) {
        console.error("Audio buffer is empty, cannot encrypt.");
        updateWaveformMessage(displayElement, 'Error: Audio data is empty. Cannot generate encrypted pattern.', '#ff6b6b');
        return null;
    }

    // Metadata pixels:
    // Pixel 0: numSamples
    // Pixel 1: sampleRate
    const metadataPixels = 2;
    const totalPixelsRequired = numSamples + metadataPixels;

    const canvas = document.createElement('canvas');
    // Calculate canvas dimensions
    // Ensure width is at least 2 if metadataPixels is 2, to hold both metadata pixels on the first row.
    canvas.width = Math.max(metadataPixels, Math.ceil(Math.sqrt(totalPixelsRequired)));
    canvas.height = Math.ceil(totalPixelsRequired / canvas.width);

    displayElement.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.error("Failed to get canvas context for encryption.");
        updateWaveformMessage(displayElement, 'Error: Cannot initialize display for encrypted pattern.', '#ff6b6b');
        return null;
    }

    // Clear canvas with a background color
    ctx.fillStyle = '#000000'; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // --- Store Metadata (Number of Samples) in the first pixel (0,0) ---
    const rMeta = (numSamples >> 24) & 0xFF;
    const gMeta = (numSamples >> 16) & 0xFF;
    const bMeta = (numSamples >> 8) & 0xFF;
    const aMeta = numSamples & 0xFF;
    ctx.fillStyle = `rgba(${rMeta}, ${gMeta}, ${bMeta}, ${aMeta / 255.0})`;
    ctx.fillRect(0, 0, 1, 1); // Store numSamples at (0,0)

    // --- Store Sample Rate in the second pixel (1,0) ---
    const sampleRate = audioBuffer.sampleRate;
    const srR = (sampleRate >> 24) & 0xFF;
    const srG = (sampleRate >> 16) & 0xFF;
    const srB = (sampleRate >> 8) & 0xFF;
    const srA = sampleRate & 0xFF;
    ctx.fillStyle = `rgba(${srR}, ${srG}, ${srB}, ${srA / 255.0})`;
    ctx.fillRect(1, 0, 1, 1); // Store sampleRate at (1,0)


    // --- Store Audio Data Sequentially ---
    // Audio data starts after the metadata pixels.
    // Pixel 0: numSamples, Pixel 1: sampleRate. Data starts at Pixel index 2.
    let currentDataPixelIndex = metadataPixels; // This is the logical index of the pixel in the flattened grid
    let dataPixelX, dataPixelY;

    for (let i = 0; i < numSamples; i++) {
        const sample = channelData[i];
        // Normalize sample from [-1, 1] to [0, 255]
        const normalizedSample = Math.floor(((sample + 1) / 2) * 255);

        // Calculate current pixel coordinates for audio data
        dataPixelX = currentDataPixelIndex % canvas.width;
        dataPixelY = Math.floor(currentDataPixelIndex / canvas.width);
        
        // Ensure we don't write outside canvas bounds
        if (dataPixelY >= canvas.height) {
            console.warn(`Attempting to write audio data outside canvas height (${dataPixelY} >= ${canvas.height}). Index: ${i}, numSamples: ${numSamples}. currentDataPixelIndex: ${currentDataPixelIndex}`);
            break; 
        }

        ctx.fillStyle = `rgb(${normalizedSample}, 0, 0)`; // Store in Red channel, G=0, B=0
        ctx.fillRect(dataPixelX, dataPixelY, 1, 1);
        currentDataPixelIndex++; // Move to the next pixel for the next sample
    }

    console.log(`Encryption complete. Stored ${numSamples} samples and sample rate ${sampleRate}. Canvas: ${canvas.width}x${canvas.height}`);
    return canvas;
}

/**
 * "Decrypts" an image from a canvas back into an AudioBuffer.
 * @param {HTMLCanvasElement} canvasElement - The canvas containing the image.
 * @param {number} targetSampleRate - The sample rate for the output AudioBuffer.
 * @returns {AudioBuffer|null} The decrypted audio data, or null on failure.
 */
// Note: When decrypting a loaded image, the 'targetSampleRate' relies on the
// 'lastRecordedSampleRate' from the current session or a default. If the loaded image
// was originally encrypted with a different sample rate, playback speed/pitch may be affected.
// Future improvements could involve embedding metadata (like sample rate) into the image itself.
function decryptImageToAudio(canvasElement, targetSampleRate) {
    const userKey = getUserSecretKey();
    if (userKey === null) return null; // Error handled by getUserSecretKey
    if (userKey.trim() === '') {
        console.error("Decryption halted: Secret Key is missing.");
        // Message in waveform display area handled by caller (playButton event listener)
        alert("Secret Key is required to decrypt the data pattern. Please enter a key.");
        return null;
    }

    if (!canvasElement) {
        console.error("Decryption error: No canvas element provided for data pattern.");
        alert("Decryption Error: No data pattern loaded to decrypt.");
        return null;
    }
    const ctx = canvasElement.getContext('2d');
    if (!ctx) {
        console.error("Decryption error: Could not get canvas context from data pattern.");
        alert("Decryption Error: Cannot process loaded data pattern.");
        return null;
    }

    const imageData = ctx.getImageData(0, 0, canvasElement.width, canvasElement.height);
    const pixelDataArray = imageData.data;

    // --- Retrieve Metadata (Number of Samples) from the first pixel (0,0) ---
    // RGBA values are at indices 0, 1, 2, 3 for the first pixel
    // --- Retrieve Metadata ---
    // Pixel (0,0) for Number of Samples
    const rMetaSamples = pixelDataArray[0];
    const gMetaSamples = pixelDataArray[1];
    const bMetaSamples = pixelDataArray[2];
    const aMetaSamples = pixelDataArray[3]; 
    const numberOfSamples = (rMetaSamples << 24) | (gMetaSamples << 16) | (bMetaSamples << 8) | aMetaSamples;

    // Basic sanity check for numberOfSamples
    const totalCanvasPixels = canvasElement.width * canvasElement.height;
    // metadataPixels is not defined in this scope, but it's 2. Hardcoding for now or pass as param later if necessary.
    const expectedMetadataPixels = 2; 
    if (isNaN(numberOfSamples) || numberOfSamples <= 0 || numberOfSamples > totalCanvasPixels - expectedMetadataPixels) { 
        console.error(`Decryption failed: Invalid number of samples read from metadata: ${numberOfSamples}. Canvas pixels: ${totalCanvasPixels}, metadata pixels: ${expectedMetadataPixels}`);
        alert("Decryption Failed: Data pattern metadata for 'number of samples' is corrupted or unreadable.");
        return null;
    }
    console.log(`Retrieved metadata: Expecting ${numberOfSamples} samples.`);

    // Pixel (1,0) for Sample Rate (indices 4,5,6,7 of pixelDataArray)
    if (pixelDataArray.length < expectedMetadataPixels * 4) { 
        console.error(`Decryption failed: Data pattern too short for all metadata. Expected ${expectedMetadataPixels*4} bytes, got ${pixelDataArray.length}.`);
        alert("Decryption Failed: Data pattern is too small to contain all necessary metadata (e.g., sample rate).");
        return null;
    }
    const rMetaSR = pixelDataArray[4];
    const gMetaSR = pixelDataArray[5];
    const bMetaSR = pixelDataArray[6];
    const aMetaSR = pixelDataArray[7];
    let actualSampleRate = (rMetaSR << 24) | (gMetaSR << 16) | (bMetaSR << 8) | aMetaSR;

    if (isNaN(actualSampleRate) || actualSampleRate <= 0 || actualSampleRate > 192000) { // Sanity check for sample rate
        console.warn(`Warning: Suspicious sample rate ${actualSampleRate} read from data pattern. Using fallback or default.`);
        // Fallback logic: if targetSampleRate is provided and valid, use it. Otherwise, use a common default.
        actualSampleRate = (targetSampleRate && targetSampleRate > 0 && targetSampleRate <= 192000) ? targetSampleRate : 44100;
        alert(`Warning: Could not read a valid sample rate from the data pattern. Using ${actualSampleRate} Hz. Audio may not sound correct if this is not the original rate.`);
    } else {
        console.log(`Retrieved metadata: Sample Rate ${actualSampleRate} Hz.`);
    }


    // --- Retrieve Audio Data Sequentially ---
    let recoveredSamples = [];
    // Audio data starts after the metadata pixels.
    const firstDataPixelLogicalIndex = expectedMetadataPixels; // expectedMetadataPixels is 2

    for (let i = 0; i < numberOfSamples; i++) {
        const currentDataPixelLogicalIndex = firstDataPixelLogicalIndex + i;
        const pixelArrayIndex = currentDataPixelLogicalIndex * 4; // Each pixel takes 4 spots (R,G,B,A)

        if (pixelArrayIndex + 3 >= pixelDataArray.length) { // Check if R,G,B,A for this pixel are accessible
            console.error(`Decryption error: Trying to read audio data beyond data pattern bounds. Expected ${numberOfSamples} samples, ran out at sample ${i}. Pixel array index: ${pixelArrayIndex}, array length: ${pixelDataArray.length}`);
            alert("Decryption Failed: Data pattern is too short for the expected number of audio samples.");
            return null; 
        }

        const normalizedSample = pixelDataArray[pixelArrayIndex]; // Red channel contains the audio data
        // Denormalize sample from [0, 255] back to [-1, 1]
        const sample = (normalizedSample / 255.0) * 2.0 - 1.0;
        recoveredSamples.push(sample);
    }

    if (recoveredSamples.length !== numberOfSamples) {
        console.warn(`Decryption warning: Expected ${numberOfSamples} samples based on metadata, but recovered ${recoveredSamples.length}. This may indicate data truncation or corruption.`);
        // No alert for now, proceed with what was recovered. If length is 0, it will be handled below.
    }
    
    if (recoveredSamples.length === 0 && numberOfSamples > 0) {
        console.error("Decryption failed: No audio samples recovered despite metadata indicating samples were present.");
        alert("Decryption Failed: Audio data could not be extracted from the pattern, though metadata was found.");
        return null;
    }

    // --- Use Global Playback Context for AudioBuffer Creation ---
    if (!globalPlaybackContext || globalPlaybackContext.state === 'closed') {
        try {
            globalPlaybackContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log("Global playback AudioContext created/recreated in decryptImageToAudio for Buffer creation.");
        } catch (e) {
            console.error("Failed to create Global playback AudioContext in decryptImageToAudio for Buffer creation:", e);
            alert("Audio system critical error. Could not initialize audio playback. Please refresh the page or try a different browser.");
            return null;
        }
    }

    // Note: Resuming 'suspended' context is primarily handled by playAudioBuffer.
    // If globalPlaybackContext.state === 'suspended', createBuffer will still work.

    try {
        // Use the sampleRate read from the data pattern and the globalPlaybackContext
        const outputAudioBuffer = globalPlaybackContext.createBuffer(1, recoveredSamples.length, actualSampleRate);
        const outputChannelData = outputAudioBuffer.getChannelData(0);

        for (let i = 0; i < recoveredSamples.length; i++) {
            outputChannelData[i] = recoveredSamples[i];
        }
        
        console.log(`Decryption complete. Created AudioBuffer with ${recoveredSamples.length} samples at ${actualSampleRate} Hz using globalPlaybackContext.`);
        return outputAudioBuffer;
    } catch (error) {
        console.error("Error creating AudioBuffer during decryption with globalPlaybackContext:", error);
        alert("Decryption Error: Could not create audio buffer. " + error.message + ". The sample rate or number of samples might be invalid.");
        return null;
    }
    // No finally block needed here to close globalPlaybackContext, as it's managed globally.
}

// --- Web Audio API Utility Functions ---

async function requestMicrophonePermission() {
    console.log('Requesting microphone permission...');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('Microphone permission granted.');
        return stream;
    } catch (error) {
        console.error('Microphone permission denied or no microphone found:', error);
        alert('Microphone permission denied or no microphone found. Please allow microphone access in your browser settings.');
        throw error;
    }
}

function captureAudio(stream) {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const bufferSize = 4096;
    const scriptNode = audioContext.createScriptProcessor(bufferSize, 1, 1);
    let recordedChunks = [];

    scriptNode.onaudioprocess = (audioProcessingEvent) => {
        const channelData = audioProcessingEvent.inputBuffer.getChannelData(0);
        recordedChunks.push(new Float32Array(channelData));
    };

    source.connect(scriptNode);

    function stop() {
        return new Promise((resolve) => {
            source.disconnect(scriptNode);
            stream.getTracks().forEach(track => track.stop());
            console.log('Microphone tracks stopped.');

            if (recordedChunks.length === 0) {
                console.warn('No audio data recorded.');
                return resolve(null);
            }

            const totalLength = recordedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const combinedBuffer = new Float32Array(totalLength);
            let offset = 0;
            for (const chunk of recordedChunks) {
                combinedBuffer.set(chunk, offset);
                offset += chunk.length;
            }

            const outputAudioBuffer = audioContext.createBuffer(1, combinedBuffer.length, audioContext.sampleRate);
            outputAudioBuffer.copyToChannel(combinedBuffer, 0);

            console.log('AudioBuffer created from recorded chunks.');
            recordedChunks = [];
            resolve(outputAudioBuffer);
        });
    }
    return { stop, audioContext };
}

function playAudioBuffer(audioBuffer, audioCtxToUse) {
    if (!audioBuffer || audioBuffer.length === 0) {
        console.warn("Cannot play empty or null AudioBuffer.");
        return null;
    }
    if (!audioCtxToUse || audioCtxToUse.state === 'closed') {
        console.warn("Provided AudioContext for playback is closed or null. Cannot play.");
        return null;
    }

    const playLogic = () => {
        const sourceNode = audioCtxToUse.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.connect(audioCtxToUse.destination);
        sourceNode.start(0);
        sourceNode.onended = () => console.log('Audio playback finished.');
        return sourceNode;
    };

    if (audioCtxToUse.state === 'suspended') {
        audioCtxToUse.resume().then(() => {
            console.log("Playback AudioContext resumed.");
            return playLogic();
        }).catch(e => {
            console.error("Error resuming playback AudioContext:", e);
            alert("Could not resume audio. Please interact with the page and try again.");
            return null;
        });
    } else {
        return playLogic();
    }
}

// --- DOMContentLoaded: Entry point for UI setup and event listeners ---
document.addEventListener('DOMContentLoaded', () => {
    const recordButton = document.getElementById('record-button');
    const playButton = document.getElementById('play-button');
    const saveImageButton = document.getElementById('save-image-button'); // Get save button
    const imageUpload = document.getElementById('image-upload');
    const waveformImageDisplay = document.getElementById('waveform-image-display');

    let currentRecordingAudioContext = null;

    if (!recordButton || !playButton || !saveImageButton || !imageUpload || !waveformImageDisplay) { // Check save button
        console.error('Critical error: One or more UI elements are missing. App may not function correctly.');
        alert('Error: UI elements missing. Please check the console.');
        return;
    }

    playButton.disabled = true;
    saveImageButton.disabled = true; // Initially disable save button

    recordButton.addEventListener('click', async () => {
        const buttonText = recordButton.textContent.trim();

        if (buttonText === "Record Audio") {
            const userKeyCheck = getUserSecretKey();
            if (userKeyCheck === null || userKeyCheck.trim() === '') {
                updateWaveformMessage(waveformImageDisplay, 'Error: Secret Key is required to record and encrypt audio. Please enter a key.', '#ff6b6b');
                if (userKeyCheck !== null) alert("Secret Key is required to record and encrypt audio. Please enter a key.");
                return;
            }
            playButton.disabled = true;
            saveImageButton.disabled = true;

            try {
                updateWaveformMessage(waveformImageDisplay, "Requesting microphone permission...", "lightblue");
                const stream = await requestMicrophonePermission();
                if (!stream) {
                    updateWaveformMessage(waveformImageDisplay, "Microphone permission denied. Please allow access in your browser settings.", "orange");
                    return;
                }

                updateWaveformMessage(waveformImageDisplay, "Recording audio... Click Stop to finalize and encrypt.", "lightblue");
                mediaRecorderInstance = captureAudio(stream);
                currentRecordingAudioContext = mediaRecorderInstance.audioContext;

                recordButton.innerHTML = `${STOP_ICON} Stop Recording`;
                recordButton.style.backgroundColor = "#ff4d4d";

            } catch (err) {
                updateWaveformMessage(waveformImageDisplay, "Failed to start recording. Check microphone permissions and ensure a key is entered.", "red");
                recordButton.innerHTML = `${MIC_ICON} Record Audio`;
                recordButton.style.backgroundColor = "";
                const canvasExists = !!waveformImageDisplay.querySelector('canvas');
                playButton.disabled = !canvasExists;
                saveImageButton.disabled = !canvasExists;
            }
        } else { // Stop recording
            if (mediaRecorderInstance) {
                updateWaveformMessage(waveformImageDisplay, "Processing recorded audio...", "lightblue");
                recordButton.disabled = true;
                recordButton.innerHTML = `${STOP_ICON} Processing...`;

                try {
                    const audioBuffer = await mediaRecorderInstance.stop();

                    if (currentRecordingAudioContext && currentRecordingAudioContext.state !== 'closed') {
                        await currentRecordingAudioContext.close();
                        console.log("Recording audio context closed.");
                    }

                    if (audioBuffer) {
                        lastRecordedSampleRate = audioBuffer.sampleRate; 
                        updateWaveformMessage(waveformImageDisplay, "Generating encrypted data pattern...", "lightblue");
                        await new Promise(resolve => setTimeout(resolve, 20)); // Allow UI to update

                        const generatedCanvas = encryptAudioToImage(audioBuffer, waveformImageDisplay);

                        if (generatedCanvas) {
                            waveformImageDisplay.innerHTML = ''; // Clear "Generating..." message
                            waveformImageDisplay.appendChild(generatedCanvas);
                            // Add a success message that is then displayed below the canvas
                            const successMsgElement = document.createElement('p');
                            successMsgElement.textContent = "Audio recorded and encrypted successfully as a data pattern.";
                            successMsgElement.style.color = "#4CAF50";
                            successMsgElement.style.textAlign = "center";
                            successMsgElement.style.marginTop = "10px";
                            waveformImageDisplay.appendChild(successMsgElement);
                            playButton.disabled = false;
                            saveImageButton.disabled = false;
                        } else {
                             if (!waveformImageDisplay.textContent.includes("Error:")) { // encryptAudioToImage should set its own error
                                updateWaveformMessage(waveformImageDisplay, "Failed to generate encrypted data pattern. Ensure key is valid.", "red");
                            }
                            playButton.disabled = true;
                            saveImageButton.disabled = true;
                        }
                    } else {
                        updateWaveformMessage(waveformImageDisplay, "No audio data was recorded. Please try again.", "orange");
                        playButton.disabled = true;
                        saveImageButton.disabled = true;
                    }
                } catch (error) {
                    console.error("Error stopping recording or processing audio:", error);
                    updateWaveformMessage(waveformImageDisplay, "Error processing audio. Please try again. " + error.message, "red");
                    playButton.disabled = true;
                    saveImageButton.disabled = true;
                } finally {
                    recordButton.innerHTML = `${MIC_ICON} Record Audio`;
                    recordButton.style.backgroundColor = "";
                    recordButton.disabled = false;
                    mediaRecorderInstance = null;
                    currentRecordingAudioContext = null;

                    const canvasExists = !!waveformImageDisplay.querySelector('canvas');
                    // If there's no canvas AND no success message (meaning an error probably occurred or it's initial state)
                    if (!canvasExists && !waveformImageDisplay.querySelector('p[style*="color: #4CAF50"]')) {
                        playButton.disabled = true;
                        saveImageButton.disabled = true;
                        if (!waveformImageDisplay.textContent.includes("Error:")) { // Don't overwrite existing error messages
                           updateWaveformMessage(waveformImageDisplay, 'Record audio or load an encrypted image. Requires a secret key for all operations.');
                        }
                    } else if (!canvasExists) { // Should not happen if success message is there, but as a fallback
                        playButton.disabled = true;
                        saveImageButton.disabled = true;
                    }
                }
            }
        }
    });

    playButton.addEventListener('click', async () => {
        const userKeyCheck = getUserSecretKey();
        if (userKeyCheck === null || userKeyCheck.trim() === '') {
            updateWaveformMessage(waveformImageDisplay, 'Error: Secret Key is required to decrypt. Please enter a key.', '#ff6b6b');
            if (userKeyCheck !== null) alert("Secret Key is required to decrypt the data pattern. Please enter a key.");
            return;
        }

        const canvasEl = waveformImageDisplay.querySelector('canvas');
        if (!canvasEl) {
            alert("No encrypted data pattern loaded to decrypt. Please record audio or upload an image file.");
            updateWaveformMessage(waveformImageDisplay, "No encrypted data pattern loaded. Record audio or upload an image.", "orange");
            return;
        }
        // Clear previous non-canvas messages (like success/error from encryption) before decrypting
        const existingMessages = waveformImageDisplay.querySelectorAll('p');
        existingMessages.forEach(p => { if (p.parentNode === waveformImageDisplay) waveformImageDisplay.removeChild(p); });
        if (!waveformImageDisplay.contains(canvasEl) && waveformImageDisplay.firstChild) { // If canvas was cleared by error message
            waveformImageDisplay.insertBefore(canvasEl, waveformImageDisplay.firstChild); // Put canvas back if it was replaced by a message
        }


        updateWaveformMessage(waveformImageDisplay, "Reconstructing audio from data pattern...", "lightblue");
        playButton.disabled = true;
        
        await new Promise(resolve => setTimeout(resolve, 50)); // Allow UI to update

        const decryptedAudioBuffer = decryptImageToAudio(canvasEl, lastRecordedSampleRate); // lastRecordedSampleRate is a fallback here

        if (decryptedAudioBuffer) {
            if (!globalPlaybackContext || globalPlaybackContext.state === 'closed') {
                try {
                    globalPlaybackContext = new (window.AudioContext || window.webkitAudioContext)();
                    console.log("Global playback AudioContext created/recreated for playback.");
                } catch (e) {
                    console.error("Failed to create Global playback AudioContext for playback:", e);
                    alert("Audio system critical error. Could not initialize audio playback.");
                    updateWaveformMessage(waveformImageDisplay, "Audio system error. Cannot play audio.", "red");
                    playButton.disabled = !waveformImageDisplay.querySelector('canvas');
                    return;
                }
            }

            if (globalPlaybackContext.state === 'suspended') {
                try {
                    await globalPlaybackContext.resume();
                    console.log("Global playback AudioContext resumed for playback.");
                } catch (resumeError) {
                    console.error("Error resuming playback AudioContext:", resumeError);
                    alert("Could not resume audio playback. Please interact with the page (e.g., click) and try again.");
                    updateWaveformMessage(waveformImageDisplay, "Playback error: Could not resume audio. Please interact with page and try again.", "red");
                    playButton.disabled = !waveformImageDisplay.querySelector('canvas'); 
                    return;
                }
            }
            playAudioBuffer(decryptedAudioBuffer, globalPlaybackContext);
            // Display success message under the canvas
            const successMsgElement = document.createElement('p');
            successMsgElement.textContent = "Audio successfully reconstructed and is now playing.";
            successMsgElement.style.color = "#4CAF50";
            successMsgElement.style.textAlign = "center";
            successMsgElement.style.marginTop = "10px";
            // If canvas is still there, append. Otherwise, updateWaveformMessage (which clears)
            if (waveformImageDisplay.contains(canvasEl)) {
                 waveformImageDisplay.appendChild(successMsgElement);
            } else {
                 updateWaveformMessage(waveformImageDisplay, "Audio successfully reconstructed and is now playing.", "#4CAF50");
            }

        } else {
            // Decryption failed. decryptAudioToImage or the key check should have set a specific error message.
            if (userKeyCheck && userKeyCheck.trim() !== '' && !waveformImageDisplay.textContent.includes("Error:")) {
                 updateWaveformMessage(waveformImageDisplay, "Decryption failed. Data pattern may not match key, or pattern is corrupted/invalid.", "red");
            } else if (!waveformImageDisplay.textContent.includes("Error:")) {
                // Generic error if no specific one was set by decryptAudioToImage or key check
                updateWaveformMessage(waveformImageDisplay, "Failed to decrypt audio. Please check the key and the data pattern.", "red");
            }
        }
        playButton.disabled = !waveformImageDisplay.querySelector('canvas');
    });

    // --- Event Listener for Save Image Button ---
    saveImageButton.addEventListener('click', () => {
        const canvasElement = waveformImageDisplay.querySelector('canvas');
        if (!canvasElement) {
            alert("No encrypted data pattern to save. Please record audio first to generate one.");
            updateWaveformMessage(waveformImageDisplay, "No data pattern to save. Record audio to generate one.", "orange");
            return;
        }

        try {
            const imageDataUrl = canvasElement.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = imageDataUrl;
            link.download = 'encrypted-data-pattern.png'; // Updated filename

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            console.log("Encrypted data pattern download initiated.");
            // Keep existing message on screen, or provide temporary success:
            const prevMessage = waveformImageDisplay.querySelector('p:last-child');
            let tempMsg = document.createElement('p');
            tempMsg.textContent = "Download of data pattern started.";
            tempMsg.style.color = "#4CAF50";
            tempMsg.style.textAlign = "center";
            tempMsg.style.marginTop = "5px";
            if(prevMessage) waveformImageDisplay.insertBefore(tempMsg, prevMessage.nextSibling);
            else waveformImageDisplay.appendChild(tempMsg);
            setTimeout(() => { if(tempMsg.parentNode) tempMsg.remove(); }, 3000);

        } catch (error) {
            console.error("Error saving encrypted data pattern:", error);
            alert("Failed to save data pattern. " + error.message);
            updateWaveformMessage(waveformImageDisplay, "Error saving data pattern. Please try again.", "red");
        }
    });


    imageUpload.addEventListener('change', function(event) {
        const file = event.target.files[0];
        const waveformDisplay = document.getElementById('waveform-image-display'); 
        const playButton = document.getElementById('play-button'); 
        const saveButton = document.getElementById('save-image-button'); 

        if (!file) {
            // No file selected, or user cancelled. Don't change existing message unless it was an error.
            if (waveformDisplay.querySelector('p[style*="color: #ff6b6b"]')) { // If current message is an error
                 updateWaveformMessage(waveformDisplay, 'Record audio or load an encrypted image. Requires a secret key for all operations.');
            }
            return;
        }

        if (!file.type.startsWith('image/png')) { // Enforce PNG as it's what we save as
            updateWaveformMessage(waveformDisplay, 'Error: Invalid file type. Please upload a PNG image containing an encrypted data pattern.', '#ff6b6b');
            alert('Error: Please select a PNG image file. This application expects data patterns stored in PNG format.');
            playButton.disabled = true;
            saveButton.disabled = true; 
            event.target.value = null; 
            return;
        }
        
        updateWaveformMessage(waveformDisplay, 'Loading encrypted data pattern from file...', 'lightblue'); 

        const reader = new FileReader();

        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                waveformDisplay.innerHTML = ''; 
                const canvas = document.createElement('canvas');
                canvas.width = img.width; 
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0); 
                
                waveformDisplay.appendChild(canvas);
                console.log('Encrypted data pattern loaded from file successfully.');

                const userKeyCheck = getUserSecretKey();
                const messageElement = document.createElement('p');
                messageElement.style.textAlign = "center";
                messageElement.style.marginTop = "10px";

                if (userKeyCheck && userKeyCheck.trim() !== '') {
                    messageElement.textContent = 'Encrypted data pattern loaded. Ready to decrypt with current key.';
                    messageElement.style.color = "#4CAF50";
                } else {
                    messageElement.textContent = 'Encrypted data pattern loaded. Please enter Secret Key, then press Play to decrypt.';
                    messageElement.style.color = "orange";
                }
                waveformDisplay.appendChild(messageElement);
                playButton.disabled = false;
                saveButton.disabled = false; 
            };
            img.onerror = function() {
                updateWaveformMessage(waveformDisplay, 'Error: Could not load image data. File might be corrupted or not a valid PNG data pattern.', '#ff6b6b');
                alert('Error: The selected file could not be loaded as an image. It might be corrupted or an unsupported PNG format.');
                playButton.disabled = true;
                saveButton.disabled = true;
            };
            img.src = e.target.result; 
        };

        reader.onerror = function() {
            updateWaveformMessage(waveformDisplay, 'Error: Failed to read the selected file. Please try again.', '#ff6b6b');
            alert('Error: Failed to read the selected file.');
            playButton.disabled = true;
            saveButton.disabled = true;
        };

        reader.readAsDataURL(file);
        event.target.value = null; 
    });

    // Initial message setup
    const initialCanvas = waveformImageDisplay.querySelector('canvas');
    const initialMessageP = waveformImageDisplay.querySelector('p');

    if (!initialCanvas && (!initialMessageP || initialMessageP.textContent.includes('Click "Record Audio" to begin.'))) {
        updateWaveformMessage(waveformImageDisplay, 'Record audio or load an encrypted image. Requires a secret key for all operations.');
    }
});
```
