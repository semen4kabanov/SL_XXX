document.addEventListener('DOMContentLoaded', () => {

    // === ССЫЛКИ НА ЭЛЕМЕНТЫ ===
    const video = document.getElementById('video');
    const btnStartCamera = document.getElementById('btn-start-camera');
    const btnCapture = document.getElementById('btn-capture');
    const btnResetCamera = document.getElementById('btn-reset-camera');
    const canvasEtalonOverlay = document.getElementById('canvas-etalon-overlay');
    const ctxEtalon = canvasEtalonOverlay.getContext('2d');
    
    const btnSaveEtalon = document.getElementById('btn-save-etalon');
    const btnLoadEtalon = document.getElementById('btn-load-etalon');

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const browseLink = document.getElementById('browse-link');
    const photoPreview = document.getElementById('photo-preview');
    const canvasGroupOverlay = document.getElementById('canvas-group-overlay');
    const ctxGroup = canvasGroupOverlay.getContext('2d');
    const groupContainer = document.getElementById('group-container');

    const btnRecognize = document.getElementById('btn-recognize');
    const btnResetGroup = document.getElementById('btn-reset-group');

    const statusEtalon = document.getElementById('status-etalon');
    const statusGroup = document.getElementById('status-group');

    // === КОНСТАНТЫ ===
    const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/';
    const MATCH_THRESHOLD = 0.6;
    const MAX_GROUP_WIDTH = 640;
    const STORAGE_KEY = 'face-match-etalon-v1';

    // === СОСТОЯНИЕ ===
    const state = {
        etalonDescriptor: null,
        etalonPreview: null,
        isCameraActive: false,
        isProcessing: false,
        modelsReady: false
    };

    // === УТИЛИТЫ ===
    const setStatus = (elem, text, type = 'loading') => {
        elem.textContent = text;
        elem.className = `status-msg status-${type}`;
    };

    const clearOverlay = (ctx, canvas) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    const resizeImg = (img, maxWidth) => {
        return new Promise((resolve) => {
            const scaleFactor = Math.min(1, maxWidth / img.width);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scaleFactor);
            canvas.height = Math.round(img.height * scaleFactor);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
        });
    };

    const drawFaceBox = (ctx, box, label, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        const fontSize = Math.max(14, Math.round(box.width / 10));
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.fillStyle = color;
        ctx.fillText(label, box.x, box.y > fontSize + 4 ? box.y - 6 : box.y + fontSize + 2);
    };

    // === LOCAL STORAGE ===
    const saveEtalonToStorage = () => {
        if (!state.etalonDescriptor) return false;
        try {
            const payload = {
                descriptor: Array.from(state.etalonDescriptor),
                preview: state.etalonPreview,
                savedAt: Date.now()
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
            return true;
        } catch (e) {
            console.warn('Не удалось сохранить эталон:', e);
            return false;
        }
    };

    const loadEtalonFromStorage = () => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed.descriptor) || parsed.descriptor.length !== 128) return null;
            return parsed;
        } catch {
            return null;
        }
    };

    const hasStoredEtalon = () => !!loadEtalonFromStorage();

    const applyEtalon = (descriptor, previewDataUrl, sourceLabel) => {
        state.etalonDescriptor = descriptor;
        state.etalonPreview = previewDataUrl;

        if (previewDataUrl) {
            const img = new Image();
            img.onload = () => {
                canvasEtalonOverlay.width = img.naturalWidth;
                canvasEtalonOverlay.height = img.naturalHeight;
                clearOverlay(ctxEtalon, canvasEtalonOverlay);
                ctxEtalon.drawImage(img, 0, 0);
            };
            img.src = previewDataUrl;
        }

        btnSaveEtalon.disabled = false;
        btnRecognize.disabled = !photoPreview.src;
        setStatus(statusEtalon, sourceLabel, 'success');
    };

    // === ИНИЦИАЛИЗАЦИЯ МОДЕЛЕЙ ===
    const initModels = async () => {
        try {
            setStatus(statusGroup, 'Загрузка моделей AI...');
            await Promise.all([
                faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
                faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
                faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
            ]);
            state.modelsReady = true;
            setStatus(statusGroup, 'Модели готовы. Загрузите фото.', 'success');
        } catch (err) {
            setStatus(statusGroup, `Не удалось загрузить модели: ${err.message}`, 'error');
        }
    };

    // === КАМЕРА ===
    const startCamera = async () => {
        try {
            setStatus(statusEtalon, 'Включение камеры...');
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: 640 }
            });
            video.srcObject = stream;
            await video.play();
            state.isCameraActive = true;
            btnStartCamera.disabled = true;
            btnCapture.disabled = false;
            btnResetCamera.disabled = false;
            setStatus(statusEtalon, 'Камера активна', 'success');
        } catch (err) {
            setStatus(statusEtalon, `Ошибка камеры: ${err.name}`, 'error');
        }
    };

    const stopCamera = () => {
        const stream = video.srcObject;
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
        state.isCameraActive = false;
        btnStartCamera.disabled = false;
        btnCapture.disabled = true;
        btnResetCamera.disabled = true;
    };

    const captureEtalon = async () => {
        if (!state.modelsReady) {
            setStatus(statusEtalon, 'Модели ещё загружаются...', 'error');
            return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        stopCamera();

        const img = new Image();
        img.onload = async () => {
            canvasEtalonOverlay.width = canvas.width;
            canvasEtalonOverlay.height = canvas.height;
            clearOverlay(ctxEtalon, canvasEtalonOverlay);
            ctxEtalon.drawImage(img, 0, 0, canvas.width, canvas.height);

            setStatus(statusEtalon, 'Анализ лица...');
            try {
                const detection = await faceapi
                    .detectSingleFace(img, new faceapi.SsdMobilenetv1Options())
                    .withFaceLandmarks(true)
                    .withFaceDescriptor();

                if (detection) {
                    state.etalonDescriptor = detection.descriptor;
                    state.etalonPreview = canvas.toDataURL('image/jpeg', 0.85);
                    
                    clearOverlay(ctxEtalon, canvasEtalonOverlay);
                    ctxEtalon.drawImage(img, 0, 0, canvas.width, canvas.height);
                    drawFaceBox(ctxEtalon, detection.detection.box, 'Эталон', 'lime');
                    
                    btnSaveEtalon.disabled = false;
                    btnRecognize.disabled = !photoPreview.src;
                    setStatus(statusEtalon, 'Готово. Лицо сохранено в памяти.', 'success');
                } else {
                    setStatus(statusEtalon, 'Лицо не найдено. Попробуйте ещё раз.', 'error');
                }
            } catch (err) {
                setStatus(statusEtalon, `Ошибка анализа: ${err.message}`, 'error');
            }
        };
        img.src = canvas.toDataURL('image/jpeg', 0.9);
    };

    // === ЗАГРУЗКА ФАЙЛА ===
    const processFile = (file) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            return setStatus(statusGroup, 'Нужен файл изображения', 'error');
        }
        if (file.size > 10 * 1024 * 1024) {
            return setStatus(statusGroup, 'Файл больше 10 МБ', 'error');
        }

        setStatus(statusGroup, 'Обработка изображения...');
        btnRecognize.disabled = true;
        btnResetGroup.disabled = true;
        clearOverlay(ctxGroup, canvasGroupOverlay);

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = async () => {
                try {
                    const compressedDataUrl = await resizeImg(img, MAX_GROUP_WIDTH);
                    photoPreview.src = compressedDataUrl;
                    groupContainer.style.display = 'block';

                    photoPreview.onload = () => {
                        canvasGroupOverlay.width = photoPreview.naturalWidth;
                        canvasGroupOverlay.height = photoPreview.naturalHeight;
                        clearOverlay(ctxGroup, canvasGroupOverlay);
                        btnRecognize.disabled = !state.etalonDescriptor;
                        btnResetGroup.disabled = false;
                        setStatus(statusGroup, 'Фото загружено. Нажмите «Найти себя».', 'success');
                    };
                } catch (err) {
                    setStatus(statusGroup, `Ошибка обработки: ${err.message}`, 'error');
                }
            };
            img.onerror = () => setStatus(statusGroup, 'Не удалось прочитать изображение', 'error');
            img.src = e.target.result;
        };
        reader.onerror = () => setStatus(statusGroup, 'Ошибка чтения файла', 'error');
        reader.readAsDataURL(file);
    };

    // Drag & Drop
    ['dragenter', 'dragover'].forEach(evt =>
        dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.add('dragover'); })
    );
    ['dragleave', 'drop'].forEach(evt =>
        dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.remove('dragover'); })
    );
    dropZone.addEventListener('drop', e => processFile(e.dataTransfer.files[0]));
    dropZone.addEventListener('click', () => fileInput.click());
    browseLink.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
    fileInput.addEventListener('change', e => {
        if (e.target.files[0]) processFile(e.target.files[0]);
        e.target.value = '';
    });

    // === РАСПОЗНАВАНИЕ ===
    const recognizeFaces = async () => {
        if (!state.modelsReady) return setStatus(statusGroup, 'Модели ещё загружаются', 'error');
        if (!state.etalonDescriptor) return setStatus(statusGroup, 'Сначала сделайте селфи', 'error');
        if (!photoPreview.src) return setStatus(statusGroup, 'Сначала загрузите групповое фото', 'error');
        if (state.isProcessing) return;

        state.isProcessing = true;
        btnRecognize.disabled = true;
        setStatus(statusGroup, 'Поиск...');
        clearOverlay(ctxGroup, canvasGroupOverlay);

        try {
            const detections = await faceapi
                .detectAllFaces(photoPreview, new faceapi.SsdMobilenetv1Options())
                .withFaceLandmarks(true)
                .withFaceDescriptors();

            if (!detections.length) {
                return setStatus(statusGroup, 'Лица не найдены', 'error');
            }

            let bestMatch = null;
            let minDistance = Number.MAX_VALUE;

            detections.forEach(det => {
                const distance = faceapi.euclideanDistance(state.etalonDescriptor, det.descriptor);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = det;
                }
            });

            detections.forEach(det => {
                const distance = faceapi.euclideanDistance(state.etalonDescriptor, det.descriptor);
                const score = (1 - distance).toFixed(2);
                const isBest = det === bestMatch && distance < MATCH_THRESHOLD;
                drawFaceBox(
                    ctxGroup,
                    det.detection.box,
                    isBest ? `Это вы! (${score})` : `Сходство: ${score}`,
                    isBest ? 'lime' : 'yellow'
                );
            });

            if (bestMatch && minDistance < MATCH_THRESHOLD) {
                setStatus(statusGroup, `Найдено совпадение: ${((1 - minDistance) * 100).toFixed(1)}%`, 'success');
            } else {
                setStatus(statusGroup, 'Совпадений не найдено', 'error');
            }
        } catch (err) {
            setStatus(statusGroup, `Ошибка распознавания: ${err.message}`, 'error');
        } finally {
            state.isProcessing = false;
            btnRecognize.disabled = false;
        }
    };

    // === ОБРАБОТЧИКИ ===
    btnStartCamera.addEventListener('click', startCamera);
    btnCapture.addEventListener('click', captureEtalon);
    
    btnResetCamera.addEventListener('click', () => {
        stopCamera();
        clearOverlay(ctxEtalon, canvasEtalonOverlay);
        state.etalonDescriptor = null;
        state.etalonPreview = null;
        canvasEtalonOverlay.width = 0;
        canvasEtalonOverlay.height = 0;
        btnSaveEtalon.disabled = true;
        btnRecognize.disabled = true;
        setStatus(statusEtalon, 'Текущий эталон сброшен', 'success');
        btnLoadEtalon.disabled = !hasStoredEtalon();
    });

    btnSaveEtalon.addEventListener('click', () => {
        if (saveEtalonToStorage()) {
            setStatus(statusEtalon, 'Эталон сохранён в браузере', 'success');
            btnLoadEtalon.disabled = false;
        } else {
            setStatus(statusEtalon, 'Не удалось сохранить эталон', 'error');
        }
    });

    btnLoadEtalon.addEventListener('click', () => {
        const stored = loadEtalonFromStorage();
        if (!stored) return setStatus(statusEtalon, 'Сохранённый эталон не найден', 'error');
        applyEtalon(
            new Float32Array(stored.descriptor),
            stored.preview,
            'Эталон загружен из сохранения'
        );
    });

    btnRecognize.addEventListener('click', recognizeFaces);

    btnResetGroup.addEventListener('click', () => {
        photoPreview.src = '';
        groupContainer.style.display = 'none';
        canvasGroupOverlay.width = 0;
        canvasGroupOverlay.height = 0;
        btnRecognize.disabled = true;
        btnResetGroup.disabled = true;
        setStatus(statusGroup, state.modelsReady ? 'Модели готовы. Загрузите фото.' : 'Загрузка моделей AI...', 'loading');
    });

    // === ЗАПУСК ===
    initModels();

    if (hasStoredEtalon()) {
        btnLoadEtalon.disabled = false;
        setStatus(statusEtalon, 'Найден сохранённый эталон. Нажмите «Загрузить» или сделайте новое фото.', 'loading');
        
        const stored = loadEtalonFromStorage();
        if (stored) {
            applyEtalon(new Float32Array(stored.descriptor), stored.preview, 'Эталон восстановлен из сохранения');
        }
    }
});
