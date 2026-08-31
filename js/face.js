// face.js - gerenciamento de modelos e helpers faciais
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model';
// fallback para justadude
const MODEL_URL2 = 'https://justadudewhohacks.github.io/face-api.js/models';

let modelsLoaded = false;

async function loadModels() {
  const statusEl = document.getElementById('faceStatus');
  try {
    statusEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-1"></i> Carregando IA facial...';
    // tenta CDN 1
    let url = MODEL_URL2;
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(url),
      faceapi.nets.faceLandmark68Net.loadFromUri(url),
      faceapi.nets.faceRecognitionNet.loadFromUri(url),
      faceapi.nets.ssdMobilenetv1.loadFromUri(url)
    ]);
    modelsLoaded = true;
    statusEl.className = 'px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium';
    statusEl.innerHTML = '<i class="fa-solid fa-check-circle mr-1"></i> IA facial pronta';
    console.log('✓ Modelos face-api carregados');
  } catch (e) {
    console.error('Erro ao carregar modelos', e);
    statusEl.className = 'px-3 py-1 rounded-full bg-red-100 text-red-700 text-xs font-medium';
    statusEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation mr-1"></i> Falha IA - recarregue a página';
  }
}

function euclideanDistance(d1, d2) {
  let sum = 0;
  for (let i = 0; i < d1.length; i++) sum += (d1[i] - d2[i]) ** 2;
  return Math.sqrt(sum);
}

async function getDescriptorFromVideo(videoEl) {
  const detection = await faceapi
    .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return detection; // {descriptor, detection, landmarks}
}

async function getDescriptorFromImage(imageEl) {
  const detection = await faceapi.detectSingleFace(imageEl, new faceapi.SsdMobilenetv1Options()).withFaceLandmarks().withFaceDescriptor();
  return detection;
}

function descriptorToArray(desc) {
  return Array.from(desc);
}

function captureFrameAsDataURL(videoEl, canvasEl) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  canvasEl.width = w;
  canvasEl.height = h;
  const ctx = canvasEl.getContext('2d');
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(videoEl, 0, 0, w, h);
  return canvasEl.toDataURL('image/jpeg', 0.8);
}

// inicia carregamento assim que face-api carregar
if (typeof faceapi !== 'undefined') {
  loadModels();
} else {
  window.addEventListener('load', loadModels);
}
