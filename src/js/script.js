    let globalPlaybackContext = null;
    let lastDecryptedBuffer = null;

    const SALT_LENGTH = 16;
    const IV_LENGTH = 12;
    const CIPHERTEXT_LENGTH_BYTES = 4;
    const SAMPLE_RATE_BYTES = 4;
    const HEADER_LENGTH = SALT_LENGTH + IV_LENGTH + CIPHERTEXT_LENGTH_BYTES + SAMPLE_RATE_BYTES;
    const BYTES_PER_PIXEL = 3;

    let errorDisplay = null; // Will be assigned in DOMContentLoaded
    let errorTimeout = null;

    function showError(message, duration = 7000) {
        if (errorDisplay) {
            errorDisplay.textContent = message;
            errorDisplay.style.display = 'block';
            
            if (errorTimeout) {
                clearTimeout(errorTimeout);
            }
            if (duration > 0) {
                errorTimeout = setTimeout(() => {
                    errorDisplay.style.display = 'none';
                    errorDisplay.textContent = '';
                }, duration);
            }
        }
    }

    function clearError() {
        if (errorDisplay) {
            errorDisplay.style.display = 'none';
            errorDisplay.textContent = '';
            if (errorTimeout) {
                clearTimeout(errorTimeout);
                errorTimeout = null;
            }
        }
    }

    function checkPasswordStrength(password) {
      if (password.length < 6) return { score: 0, text: 'Too Short', class: 'weak' };
      let score = 1;
      if (password.length >= 12) score++;
      if (/[a-z]/.test(password)) score++;
      if (/[A-Z]/.test(password)) score++;
      if (/[0-9]/.test(password)) score++;
      if (/[^A-Za-z0-9]/.test(password)) score++;
      if (score < 2) return { score, text: 'Weak', class: 'weak' };
      if (score < 5) return { score, text: 'Medium', class: 'medium' };
      return { score, text: 'Strong', class: 'strong' };
    }

    function getUserSecretKey() {
      return document.getElementById('secret-key-input').value.trim();
    }

    async function deriveKey(passphrase, salt) {
      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw', encoder.encode(passphrase), { name: 'PBKDF2' }, false, ['deriveKey']
      );
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 }, false,
        ['encrypt','decrypt']
      );
    }

    async function encryptAudioToImage(audioBuffer, container) {
      const pass = getUserSecretKey(); 
      if (!pass) throw new Error('Secret key is required');
      const strength = checkPasswordStrength(pass);
      if (strength.score < 2) {
        throw new Error('Password is too weak. Use at least 8 characters with mixed case, numbers, and symbols.');
      }
      const channelData = audioBuffer.getChannelData(0);
      const payloadRaw = channelData.buffer;
      const originalSampleRate = audioBuffer.sampleRate;

      const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      const key = await deriveKey(pass, salt);
      const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
      const cipher = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, payloadRaw);
      const cipherBytes = new Uint8Array(cipher);

      const header = new Uint8Array(HEADER_LENGTH);
      const headerView = new DataView(header.buffer);
      header.set(salt, 0);
      header.set(iv, SALT_LENGTH);
      headerView.setUint32(SALT_LENGTH + IV_LENGTH, cipherBytes.length, false);
      headerView.setUint32(SALT_LENGTH + IV_LENGTH + CIPHERTEXT_LENGTH_BYTES, originalSampleRate, false);

      const totalDataLength = header.byteLength + cipherBytes.length;
      const fullPayload = new Uint8Array(totalDataLength);
      fullPayload.set(header, 0);
      fullPayload.set(cipherBytes, header.byteLength);

      const numPixelsRequired = Math.ceil(totalDataLength / BYTES_PER_PIXEL);
      const w = Math.ceil(Math.sqrt(numPixelsRequired));
      const h = Math.ceil(numPixelsRequired / w);
      
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      const imgData = ctx.createImageData(w,h);
      
      let payloadIdx = 0;
      for (let i = 0; i < imgData.data.length; i += 4) {
          if (payloadIdx < totalDataLength) imgData.data[i] = fullPayload[payloadIdx++]; else imgData.data[i] = 0;
          if (payloadIdx < totalDataLength) imgData.data[i + 1] = fullPayload[payloadIdx++]; else imgData.data[i + 1] = 0;
          if (payloadIdx < totalDataLength) imgData.data[i + 2] = fullPayload[payloadIdx++]; else imgData.data[i + 2] = 0;
          imgData.data[i + 3] = 255;
          if (payloadIdx >= totalDataLength && i/4 >= numPixelsRequired -1) break;
      }
      ctx.putImageData(imgData, 0, 0);
      container.innerHTML = ''; 
      container.appendChild(canvas);
      return canvas;
    }

    async function decryptImageToAudio(canvas) {
      const pass = getUserSecretKey(); 
      if (!pass) throw new Error('Secret key is required');
      
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0,0,canvas.width,canvas.height);
      const pixelData = imageData.data;
      
      const maxPossibleDataBytes = Math.floor(pixelData.length / 4) * BYTES_PER_PIXEL;
      const allExtractedBytes = new Uint8Array(maxPossibleDataBytes);
      let extractedByteIdx = 0;
      for (let i = 0; i < pixelData.length && extractedByteIdx < maxPossibleDataBytes; i += 4) {
          allExtractedBytes[extractedByteIdx++] = pixelData[i];
          if (extractedByteIdx < maxPossibleDataBytes) allExtractedBytes[extractedByteIdx++] = pixelData[i + 1];
          if (extractedByteIdx < maxPossibleDataBytes) allExtractedBytes[extractedByteIdx++] = pixelData[i + 2];
      }

      if (allExtractedBytes.length < HEADER_LENGTH) {
        throw new Error('Corrupted data: Image data too short to contain header.');
      }

      const headerView = new DataView(allExtractedBytes.buffer);
      const salt = allExtractedBytes.slice(0, SALT_LENGTH);
      const iv = allExtractedBytes.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
      const ciphertextLength = headerView.getUint32(SALT_LENGTH + IV_LENGTH, false);
      const sampleRate = headerView.getUint32(SALT_LENGTH + IV_LENGTH + CIPHERTEXT_LENGTH_BYTES, false);

      const ciphertextOffset = HEADER_LENGTH;
      const ciphertextEndOffset = ciphertextOffset + ciphertextLength;

      if (ciphertextEndOffset > allExtractedBytes.length) {
        throw new Error('Corrupted data: Declared ciphertext length exceeds available data.');
      }
      const cipher = allExtractedBytes.slice(ciphertextOffset, ciphertextEndOffset).buffer;
      
      const key = await deriveKey(pass, salt);
      let rawDecryptedAudioData;
      try {
        rawDecryptedAudioData = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, cipher);
      } catch (decryptError) {
        throw new Error('Decryption failed - incorrect key or corrupted data.');
      }

      const floatArr = new Float32Array(rawDecryptedAudioData);
      const ac = globalPlaybackContext || (globalPlaybackContext = new AudioContext());
      
      if (sampleRate <= 0 || sampleRate > 192000) { // Common sample rate range
        throw new Error(`Invalid sample rate (${sampleRate}Hz) in image. Data might be corrupted.`);
      }

      const buf = ac.createBuffer(1, floatArr.length, sampleRate);
      buf.copyToChannel(floatArr,0);
      lastDecryptedBuffer = buf;
      return buf;
    }

    function bufferToWav(buffer) {
      const numChan = buffer.numberOfChannels;
      const len = buffer.length * numChan * 2 + 44;
      const view = new DataView(new ArrayBuffer(len));
      function writeString(offset, str) {
        for (let i=0; i<str.length; i++) view.setUint8(offset+i, str.charCodeAt(i));
      }
      writeString(0, 'RIFF'); view.setUint32(4, len - 8, true); writeString(8, 'WAVE');
      writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, numChan, true); view.setUint32(24, buffer.sampleRate, true);
      view.setUint32(28, buffer.sampleRate * numChan * 2, true); view.setUint16(32, numChan * 2, true);
      view.setUint16(34, 16, true); writeString(36, 'data'); view.setUint32(40, len - 44, true);
      let offset = 44;
      for (let i=0; i<buffer.length; i++){
        for (let c=0; c<numChan; c++){
          const sample = buffer.getChannelData(c)[i];
          const s = Math.max(-1, Math.min(1, sample));
          view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
          offset += 2;
        }
      }
      return new Blob([view], { type: 'audio/wav' });
    }

    document.addEventListener('DOMContentLoaded', () => {
      errorDisplay = document.getElementById('error-message-area'); // Assign error display element

      const recordBtn = document.getElementById('record-button');
      const audioUploadInput = document.getElementById('audio-upload');
      const playBtn   = document.getElementById('play-button');
      const saveImageBtn = document.getElementById('save-image-button');
      const saveAudioBtn = document.getElementById('save-audio-button');
      const imageUploadInput = document.getElementById('image-upload');
      const display   = document.getElementById('waveform-image-display');
      const audioEl   = document.getElementById('audio-player');
      const keyInput = document.getElementById('secret-key-input');
      const strengthIndicator = document.getElementById('password-strength');

      let mediaRecorder = null;
      let audioChunks = [];
      let currentStream = null;
      let isPlaying = false;

      function updatePlayButtonState() {
        const pass = getUserSecretKey();
        const strength = checkPasswordStrength(pass);
        const canvas = display.querySelector('canvas');
        if (!isPlaying) {
            playBtn.disabled = !(canvas && pass && strength.score >= 2);
        }
      }
      
      function resetAudioPlayer() {
        if (!audioEl.paused) {
            audioEl.pause();
        }
        const oldSrc = audioEl.src;
        audioEl.removeAttribute('src');
        if (audioEl.load) audioEl.load();
        audioEl.style.display = 'none';
        if (oldSrc && oldSrc.startsWith('blob:')) {
            URL.revokeObjectURL(oldSrc);
        }
      }

      keyInput.addEventListener('input', () => {
        const password = keyInput.value;
        const strength = checkPasswordStrength(password);
        keyInput.className = strength.class;
        strengthIndicator.textContent = strength.text;
        strengthIndicator.className = `password-strength ${strength.class}`;
        updatePlayButtonState();
      });

      recordBtn.onclick = async () => {
        try {
          clearError();
          const pass = getUserSecretKey();
          if (!pass) { showError('Please enter a secret key.'); return; }
          const strength = checkPasswordStrength(pass);
          if (strength.score < 2) { showError('Password is too weak. Please use a stronger password.'); return; }
          
          if (recordBtn.classList.contains('recording')) {
            if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
            if (currentStream) { currentStream.getTracks().forEach(track => track.stop()); currentStream = null; }
            recordBtn.classList.remove('recording');
            recordBtn.innerHTML = `<i class="fas fa-microphone"></i> Record`;
          } else {
            resetAudioPlayer(); 
            lastDecryptedBuffer = null; 
            saveAudioBtn.disabled = true; 
            playBtn.disabled = true; 
            saveImageBtn.disabled = true;
            display.innerHTML = '<p><i class="fas fa-spinner fa-spin"></i> Preparing to record...</p>';

            audioChunks = [];
            currentStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(currentStream);
            mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
            mediaRecorder.onstop = async () => {
              const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
              const arrayBuffer = await audioBlob.arrayBuffer();
              const tempAudioCtx = new AudioContext();
              try {
                clearError();
                display.innerHTML = '<p><i class="fas fa-spinner fa-spin"></i> Encrypting recorded audio...</p>';
                const decodedAudioBuffer = await tempAudioCtx.decodeAudioData(arrayBuffer);
                await encryptAudioToImage(decodedAudioBuffer, display);
                updatePlayButtonState();
                saveImageBtn.disabled = false;
              } catch (e) {
                showError("Error processing recorded audio: " + e.message);
                display.innerHTML = getInitialDisplayMessage(); // Also clears error via its internal call
              } finally {
                await tempAudioCtx.close();
              }
            };
            mediaRecorder.start();
            recordBtn.classList.add('recording');
            recordBtn.innerHTML = `<i class="fas fa-microphone-slash"></i> Stop Recording`;
            display.innerHTML = '<p>Recording... Click "Stop Recording" when done.</p>';
          }
        } catch (error) {
          showError('Recording failed: ' + error.message);
          recordBtn.classList.remove('recording');
          recordBtn.innerHTML = `<i class="fas fa-microphone"></i> Record`;
          if (currentStream) { currentStream.getTracks().forEach(track => track.stop()); currentStream = null; }
          if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
          display.innerHTML = getInitialDisplayMessage();
        }
      };

      audioUploadInput.onchange = async (e) => {
        const file = e.target.files[0];
        clearError();
        if (!file) {
            e.target.value = null; 
            return;
        }

        const pass = getUserSecretKey();
        if (!pass) {
            showError('Please enter a secret key before uploading audio.');
            e.target.value = null;
            return;
        }
        const strength = checkPasswordStrength(pass);
        if (strength.score < 2) {
            showError('Password is too weak. Please use a stronger password.');
            e.target.value = null;
            return;
        }

        resetAudioPlayer();
        lastDecryptedBuffer = null;
        saveAudioBtn.disabled = true;
        playBtn.disabled = true;
        saveImageBtn.disabled = true;
        display.innerHTML = `<p><i class="fas fa-spinner fa-spin"></i> Processing uploaded audio: ${file.name}</p>`;

        try {
            const arrayBuffer = await file.arrayBuffer();
            const tempAudioCtx = new AudioContext(); 
            display.innerHTML = `<p><i class="fas fa-spinner fa-spin"></i> Decoding audio: ${file.name}</p>`;
            const decodedAudioBuffer = await tempAudioCtx.decodeAudioData(arrayBuffer);
            
            display.innerHTML = `<p><i class="fas fa-spinner fa-spin"></i> Encrypting audio: ${file.name}</p>`;
            await encryptAudioToImage(decodedAudioBuffer, display);
            
            updatePlayButtonState();
            saveImageBtn.disabled = false; 
            
            await tempAudioCtx.close(); 
        } catch (error) {
            showError("Error processing uploaded audio: " + error.message + ". Ensure it's a valid audio file (e.g., WAV, MP3).");
            display.innerHTML = getInitialDisplayMessage();
            updatePlayButtonState(); 
            saveImageBtn.disabled = !display.querySelector('canvas');
        } finally {
            e.target.value = null; 
        }
      };


      playBtn.onclick = async () => {
        clearError();
        const canvas = display.querySelector('canvas');
        if(!canvas) { showError('No image loaded to decrypt.'); return; }

        if (isPlaying) { 
            resetAudioPlayer();
            playBtn.classList.remove('playing');
            playBtn.innerHTML = `<i class="fas fa-lock-open"></i> Decrypt & Play`;
            isPlaying = false;
            updatePlayButtonState(); 
            return;
        }

        lastDecryptedBuffer = null; 
        saveAudioBtn.disabled = true; 

        try {
            playBtn.disabled = true; 
            playBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Decrypting...`;

            const decryptedAudioBuffer = await decryptImageToAudio(canvas); 
            const wavBlob = bufferToWav(decryptedAudioBuffer);
            
            resetAudioPlayer(); 

            audioEl.src = URL.createObjectURL(wavBlob);
            audioEl.style.display = ''; 
            
            await audioEl.play();

            isPlaying = true;
            playBtn.classList.add('playing');
            playBtn.innerHTML = `<i class="fas fa-stop"></i> Stop`;
            playBtn.disabled = false; 
            saveAudioBtn.disabled = !lastDecryptedBuffer;

        } catch (error) {
            showError('Decryption or Playback failed: ' + error.message);
            resetAudioPlayer(); 
            playBtn.classList.remove('playing');
            playBtn.innerHTML = `<i class="fas fa-lock-open"></i> Decrypt & Play`;
            isPlaying = false;
            lastDecryptedBuffer = null; 
            saveAudioBtn.disabled = true;
            updatePlayButtonState(); 
        }
      };
      
      audioEl.onended = () => {
        resetAudioPlayer();
        playBtn.classList.remove('playing');
        playBtn.innerHTML = `<i class="fas fa-lock-open"></i> Decrypt & Play`;
        isPlaying = false;
        updatePlayButtonState();
      };

      audioEl.onerror = (e) => {
        if (audioEl.getAttribute('src')) { 
             showError('Error playing audio: ' + (e.target.error ? e.target.error.message : 'Unknown error'));
        }
        resetAudioPlayer();
        playBtn.classList.remove('playing');
        playBtn.innerHTML = `<i class="fas fa-lock-open"></i> Decrypt & Play`;
        isPlaying = false;
        updatePlayButtonState();
      };

      saveImageBtn.onclick = () => {
        clearError();
        const canvas = display.querySelector('canvas');
        if (!canvas) {
          showError('No encrypted image to save');
          return;
        }

        const originalButtonContent = saveImageBtn.innerHTML;
        saveImageBtn.disabled = true;
        saveImageBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Saving...`;

        const restoreButton = () => {
          saveImageBtn.innerHTML = originalButtonContent;
          saveImageBtn.disabled = false;
        };

        const showSuccessAndRestore = () => {
          saveImageBtn.innerHTML = `<i class="fas fa-check"></i> Saved!`;
          setTimeout(restoreButton, 1500);
        };

        try {
          canvas.toBlob(
            (blob) => {
              if (blob) {
                try {
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = 'encrypted-audio-rgb.png';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(a.href);
                  showSuccessAndRestore();
                } catch (downloadError) {
                  showError('Error initiating download: ' + downloadError.message);
                  restoreButton();
                }
              } else {
                showError('Error saving image: Failed to generate image data.');
                restoreButton();
              }
            },
            'image/png'
          );
        } catch (setupError) {
          showError('An error occurred while preparing to save the image: ' + setupError.message);
          restoreButton();
        }
      };
      
      saveAudioBtn.onclick = () => {
        clearError();
        if (lastDecryptedBuffer) {
          const blobToSave = bufferToWav(lastDecryptedBuffer);
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blobToSave);
          a.download = 'decrypted-audio.wav';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(a.href);
        } else {
          showError('No decrypted audio available to save.');
        }
      };

      const handleImageFileUpload = (file) => { 
        clearError();
        resetAudioPlayer(); 
        
        if (isPlaying) {
            playBtn.classList.remove('playing');
            playBtn.innerHTML = `<i class="fas fa-lock-open"></i> Decrypt & Play`;
            isPlaying = false;
        }
        
        lastDecryptedBuffer = null; 
        saveAudioBtn.disabled = true;   
        display.innerHTML = `<p><i class="fas fa-spinner fa-spin"></i> Loading image: ${file ? file.name : ''}</p>`;


        if(file && file.type==='image/png'){
          const reader = new FileReader();
          reader.onload = ev=>{
            const img = new Image();
            img.onload = ()=>{
              display.innerHTML='';
              const c = document.createElement('canvas');
              c.width=img.width; c.height=img.height;
              c.getContext('2d').drawImage(img,0,0);
              display.appendChild(c);
              
              updatePlayButtonState();
              saveImageBtn.disabled = false;
            };
            img.onerror = () => { 
                showError('Failed to load image. It might be corrupted or not a valid PNG.'); 
                display.innerHTML = getInitialDisplayMessage();
            }
            img.src = ev.target.result;
          };
          reader.onerror = () => { 
            showError('Failed to read file.'); 
            display.innerHTML = getInitialDisplayMessage();
          }
          reader.readAsDataURL(file);
        } else {
            if (file) { 
                showError('Please select a valid PNG image file.');
            }
            display.innerHTML = getInitialDisplayMessage();
            saveImageBtn.disabled = true;
            updatePlayButtonState(); 
        }
      };

      imageUploadInput.onchange = e => { 
        const file = e.target.files[0];
        handleImageFileUpload(file); 
        e.target.value = null; 
      };

      display.addEventListener('dragover', e => { e.preventDefault(); display.classList.add('dragover'); });
      display.addEventListener('dragleave', () => { display.classList.remove('dragover'); });
      display.addEventListener('drop', e => {
        e.preventDefault(); display.classList.remove('dragover');
        clearError();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type === 'image/png') {
                handleImageFileUpload(file); 
            } else if (file.type.startsWith('audio/')) {
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                audioUploadInput.files = dataTransfer.files;
                const event = new Event('change', { bubbles: true });
                audioUploadInput.dispatchEvent(event);
            } else {
                showError('Please drop a PNG image or an audio file.');
            }
            e.dataTransfer.clearData();
        }
      });
      
      function getInitialDisplayMessage() {
        clearError(); // Clear any existing errors when resetting the display
        return '<p>Enter a strong key, then record audio, upload an audio file, or upload an encrypted PNG image to begin.</p>';
      }

      if(!display.querySelector('canvas')){
        display.innerHTML = getInitialDisplayMessage();
      }
      updatePlayButtonState();
    });