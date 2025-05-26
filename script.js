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
        element.innerHTML = `<p style="color:${color}; text-align: center; padding-top: 80px;">${message}</p>`;
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
    if (userKey === null) return null;
    if (userKey.trim() === '') {
        updateWaveformMessage(displayElement, 'Error: Secret Key is missing. Please enter a key.', '#ff6b6b');
        console.error("Encryption halted: Secret Key is missing.");
        return null;
    }

    if (!displayElement) {
        console.error('Error: Waveform display element not provided.');
        alert('Encryption Error: Display element missing.');
        return null;
    }
    displayElement.innerHTML = '';

    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    displayElement.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#222222';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const seed = createSeedFromString(userKey);
    const prng = seededPRNG(seed);

    if (!audioBuffer) {
        console.error("No audio buffer to encrypt.");
        ctx.fillStyle = '#FF0000';
        ctx.font = "16px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Error: No audio data", canvas.width / 2, canvas.height / 2);
        return null;
    }
    const channelData = audioBuffer.getChannelData(0);

    const maxPoints = 20000;
    const step = Math.max(1, Math.floor(channelData.length / maxPoints));

    for (let i = 0; i < channelData.length; i += step) {
        const sample = channelData[i];
        const normalizedSample = Math.floor(((sample + 1) / 2) * 255);
        const x = Math.floor(prng() * canvas.width);
        const y = Math.floor(prng() * canvas.height);
        const r = normalizedSample;
        const g = Math.floor(prng() * 256);
        const b = Math.floor(prng() * 256);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, 1, 1);
    }
    console.log("Encryption complete.");
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
    if (userKey === null) return null;
    if (userKey.trim() === '') {
        console.error("Decryption halted: Secret Key is missing.");
        alert("Secret Key is missing. Please enter a key to decrypt.");
        return null;
    }

    if (!canvasElement) {
        console.error("Decryption error: No canvas element provided.");
        alert("Decryption Error: No image found.");
        return null;
    }
    const ctx = canvasElement.getContext('2d');
    if (!ctx) {
        console.error("Decryption error: Could not get canvas context.");
        alert("Decryption Error: Cannot process image.");
        return null;
    }

    const seed = createSeedFromString(userKey);
    const prng = seededPRNG(seed);

    const maxPoints = 20000;
    let recoveredNormalizedSamples = [];

    for (let i = 0; i < maxPoints; i++) {
        const x = Math.floor(prng() * canvasElement.width);
        const y = Math.floor(prng() * canvasElement.height);
        const pixelData = ctx.getImageData(x, y, 1, 1).data;
        recoveredNormalizedSamples.push(pixelData[0]);
        prng();
        prng();
    }

    if (recoveredNormalizedSamples.length === 0) {
        console.error("Decryption failed: No data points recovered.");
        alert("Decryption Failed: Image data empty/corrupted.");
        return null;
    }

    let tempAudioCtx;
    try {
        tempAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const finalSampleRate = targetSampleRate || 44100;
        const validSamples = recoveredNormalizedSamples.filter(s => typeof s === 'number' && !isNaN(s));

        if (validSamples.length === 0) {
            console.error("Decryption error: No valid samples after filtering.");
            alert("Decryption Failed: No valid audio data from image.");
            if (tempAudioCtx && tempAudioCtx.state !== 'closed') tempAudioCtx.close();
            return null;
        }

        const outputAudioBuffer = tempAudioCtx.createBuffer(1, validSamples.length, finalSampleRate);
        const outputChannelData = outputAudioBuffer.getChannelData(0);

        for (let i = 0; i < validSamples.length; i++) {
            outputChannelData[i] = (validSamples[i] / 255.0) * 2.0 - 1.0;
        }
        console.log("AudioBuffer created from image data.");
        return outputAudioBuffer;
    } catch (error) {
        console.error("Error creating AudioBuffer during decryption:", error);
        alert("Decryption Error: Could not create audio buffer. " + error.message);
        return null;
    } finally {
        if (tempAudioCtx && tempAudioCtx.state !== 'closed') {
            tempAudioCtx.close();
        }
    }
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
                updateWaveformMessage(waveformImageDisplay, 'Error: Secret Key is missing. Please enter a key before recording.', '#ff6b6b');
                if (userKeyCheck !== null) alert("Secret Key is missing. Please enter a key before recording.");
                return;
            }
            // Disable buttons when starting recording
            playButton.disabled = true;
            saveImageButton.disabled = true;

            try {
                updateWaveformMessage(waveformImageDisplay, "Requesting permission...");
                const stream = await requestMicrophonePermission();
                if (!stream) {
                    updateWaveformMessage(waveformImageDisplay, "Microphone permission denied.", "orange");
                    return;
                }

                updateWaveformMessage(waveformImageDisplay, "Recording... Click Stop to finish.", "lightblue");
                mediaRecorderInstance = captureAudio(stream);
                currentRecordingAudioContext = mediaRecorderInstance.audioContext;

                recordButton.innerHTML = `${STOP_ICON} Stop Recording`;
                recordButton.style.backgroundColor = "#ff4d4d";
                // playButton.disabled = true; // Already done above
                // saveImageButton.disabled = true; // Already done above

            } catch (err) {
                updateWaveformMessage(waveformImageDisplay, "Failed to start recording. Check permissions.", "red");
                recordButton.innerHTML = `${MIC_ICON} Record Audio`;
                recordButton.style.backgroundColor = "";
                // Re-evaluate button states based on canvas presence (should be none here)
                const canvasExists = !!waveformImageDisplay.querySelector('canvas');
                playButton.disabled = !canvasExists;
                saveImageButton.disabled = !canvasExists;
            }
        } else { // Stop recording
            if (mediaRecorderInstance) {
                updateWaveformMessage(waveformImageDisplay, "Processing audio...", "lightblue");
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
                        updateWaveformMessage(waveformImageDisplay, "Encrypting audio to image...", "lightblue");

                        const generatedCanvas = encryptAudioToImage(audioBuffer, waveformImageDisplay);

                        if (generatedCanvas) {
                            waveformImageDisplay.innerHTML = '';
                            waveformImageDisplay.appendChild(generatedCanvas);
                            playButton.disabled = false;
                            saveImageButton.disabled = false; // Enable save button
                        } else {
                            playButton.disabled = true;
                            saveImageButton.disabled = true; // Keep save disabled
                        }
                    } else {
                        updateWaveformMessage(waveformImageDisplay, "No audio data recorded. Try again.", "orange");
                        playButton.disabled = true;
                        saveImageButton.disabled = true;
                    }
                } catch (error) {
                    console.error("Error stopping recording or processing audio:", error);
                    updateWaveformMessage(waveformImageDisplay, "Error processing audio. Please try again.", "red");
                    playButton.disabled = true;
                    saveImageButton.disabled = true;
                } finally {
                    recordButton.innerHTML = `${MIC_ICON} Record Audio`;
                    recordButton.style.backgroundColor = "";
                    recordButton.disabled = false;
                    mediaRecorderInstance = null;
                    currentRecordingAudioContext = null;

                    const canvasExists = !!waveformImageDisplay.querySelector('canvas');
                    if (!canvasExists) {
                        playButton.disabled = true;
                        saveImageButton.disabled = true;
                        if (!waveformImageDisplay.textContent.includes("Error:")) {
                            updateWaveformMessage(waveformImageDisplay, 'Click "Record Audio" to begin.');
                        }
                    }
                }
            }
        }
    });

    playButton.addEventListener('click', async () => {
        const userKeyCheck = getUserSecretKey();
        if (userKeyCheck === null || userKeyCheck.trim() === '') {
            updateWaveformMessage(waveformImageDisplay, 'Error: Secret Key is missing. Please enter a key to decrypt.', '#ff6b6b');
            if (userKeyCheck !== null) alert("Secret Key is missing. Please enter a key to decrypt.");
            return;
        }

        const canvasEl = waveformImageDisplay.querySelector('canvas');
        if (!canvasEl) {
            alert("No image available to decrypt. Please record audio first.");
            updateWaveformMessage(waveformImageDisplay, "No image to decrypt. Record audio first.", "orange");
            return;
        }

        updateWaveformMessage(waveformImageDisplay, "Decrypting image to audio...", "lightblue");
        playButton.disabled = true;
        // Keep saveImageButton enabled while playing, or disable? For now, keep enabled.

        await new Promise(resolve => setTimeout(resolve, 50));

        const decryptedAudioBuffer = decryptImageToAudio(canvasEl, lastRecordedSampleRate);

        if (decryptedAudioBuffer) {
            if (!globalPlaybackContext || globalPlaybackContext.state === 'closed') {
                globalPlaybackContext = new (window.AudioContext || window.webkitAudioContext)();
                console.log("Global playback AudioContext created/recreated.");
            }

            if (globalPlaybackContext.state === 'suspended') {
                try {
                    await globalPlaybackContext.resume();
                    console.log("Global playback AudioContext resumed.");
                } catch (resumeError) {
                    console.error("Error resuming playback context:", resumeError);
                    alert("Could not resume audio playback. Please interact with the page (e.g. click) and try again.");
                    updateWaveformMessage(waveformImageDisplay, "Playback error. Please interact and try again.", "red");
                    playButton.disabled = !waveformImageDisplay.querySelector('canvas'); // Re-enable if canvas exists
                    return;
                }
            }
            playAudioBuffer(decryptedAudioBuffer, globalPlaybackContext);
        } else {
            if (userKeyCheck && userKeyCheck.trim() !== '') {
                updateWaveformMessage(waveformImageDisplay, "Decryption failed. Image may not match key or is corrupt.", "red");
            }
        }
        // Re-enable play button if a canvas is still present
        playButton.disabled = !waveformImageDisplay.querySelector('canvas');
    });

    // --- Event Listener for Save Image Button ---
    saveImageButton.addEventListener('click', () => {
        const canvasElement = waveformImageDisplay.querySelector('canvas');
        if (!canvasElement) {
            alert("No image to save. Please generate an image first.");
            updateWaveformMessage(waveformImageDisplay, "No image to save. Record audio to generate one.", "orange");
            return;
        }

        try {
            const imageDataUrl = canvasElement.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = imageDataUrl;
            link.download = 'encrypted-waveform.png';

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            console.log("Image download initiated.");
            // Optionally provide feedback on the UI, e.g., a temporary success message
            // For now, keeping it simple. The download dialog is the main feedback.
            // updateWaveformMessage(waveformImageDisplay, 'Image download started.', '#4CAF50'); // Example feedback
        } catch (error) {
            console.error("Error saving image:", error);
            alert("Failed to save image. " + error.message);
            updateWaveformMessage(waveformImageDisplay, "Error saving image. Please try again.", "red");
        }
    });


    imageUpload.addEventListener('change', function(event) {
        const file = event.target.files[0];
        const waveformDisplay = document.getElementById('waveform-image-display'); // Already available from outer scope
        const playButton = document.getElementById('play-button'); // Already available from outer scope
        const saveButton = document.getElementById('save-image-button'); // Already available (saveImageButton)

        if (!file) {
            // User cancelled file selection, or no file selected.
            // updateWaveformMessage(waveformDisplay, 'No file selected.', '#FFA500'); // Optional: Message if no file selected
            // It's often better not to show a message if the user just cancels the dialog.
            // If a message was previously there (e.g. "Click Record..."), it remains.
            return;
        }

        // Basic file type check (client-side)
        if (!file.type.startsWith('image/')) { // Allow any image type for now, though PNG is expected
            updateWaveformMessage(waveformDisplay, 'Error: Selected file is not an image.', '#ff6b6b');
            alert('Error: Please select an image file.');
            playButton.disabled = true;
            saveButton.disabled = true; // Disable save if invalid file
            // waveformDisplay.innerHTML = ''; // Do not clear if there was a valid previous image.
                                          // If we want to clear, use updateWaveformMessage for consistency.
            event.target.value = null; // Reset file input
            return;
        }
        
        updateWaveformMessage(waveformDisplay, 'Loading image...', 'lightblue'); // Indicate loading

        const reader = new FileReader();

        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                waveformDisplay.innerHTML = ''; // Clear previous content (like messages or old canvas)
                const canvas = document.createElement('canvas');
                // Important: Set canvas dimensions to the loaded image's dimensions
                // or to the application's standard (400x200) if we want to resize/fit.
                // For now, using image's dimensions. If fixed size is needed, adjust here.
                canvas.width = img.width; 
                canvas.height = img.height;
                // If we want to enforce our app's standard canvas size (400x200) and scale the image:
                // canvas.width = 400;
                // canvas.height = 200;
                const ctx = canvas.getContext('2d');
                // ctx.drawImage(img, 0, 0, canvas.width, canvas.height); // Scales image to fit canvas
                ctx.drawImage(img, 0, 0); // Draws image at its original size, canvas matches this.
                
                waveformDisplay.appendChild(canvas);
                // updateWaveformMessage(waveformDisplay, 'Image loaded successfully. Ready to decrypt.', '#4CAF50');
                // Instead of message, image is visible. Can add small text overlay if needed.
                // For now, a console log and enabling buttons is enough feedback.
                console.log('Image loaded successfully. Ready to decrypt.');
                playButton.disabled = false;
                saveButton.disabled = false; // Enable save for the loaded image
            };
            img.onerror = function() {
                updateWaveformMessage(waveformDisplay, 'Error: Could not load image data (e.g., corrupted image).', '#ff6b6b');
                alert('Error: The selected file could not be loaded as an image. It might be corrupted or an unsupported format.');
                playButton.disabled = true;
                saveButton.disabled = true;
                // waveformDisplay.innerHTML = ''; // Clear if we don't want to show broken image icon
            };
            img.src = e.target.result; // This is the data URL from FileReader
        };

        reader.onerror = function() {
            updateWaveformMessage(waveformDisplay, 'Error: Failed to read file.', '#ff6b6b');
            alert('Error: Failed to read the selected file.');
            playButton.disabled = true;
            saveButton.disabled = true;
            // waveformDisplay.innerHTML = '';
        };

        reader.readAsDataURL(file);
        event.target.value = null; // Reset file input to allow loading the same file again if needed
    });

    if (!waveformImageDisplay.querySelector('canvas') && !waveformImageDisplay.querySelector('p')) {
        updateWaveformMessage(waveformImageDisplay, 'Click "Record Audio" to begin.');
    }
});
```
