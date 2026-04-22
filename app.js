// --- Base de Datos con Dexie ---
const db = new Dexie('SpriteAnimatorDB');
db.version(1).stores({
  characters: '++id, name' // frames se guardarán como array de Blobs dentro del objeto
});

// --- Estado de la App ---
let characters = [];
let activeCharacter = null;
let editingCharacter = null;
let activeAnimState = null; // Para la reproducción en canvas

// Estado de inserción de imágenes
let waitingAnimId = null;

// --- Elementos del DOM ---
const canvas = document.getElementById('visualizer-canvas');
const ctx = canvas.getContext('2d');
const characterListEl = document.getElementById('character-list');
const editModal = document.getElementById('edit-modal');
const animationsListEl = document.getElementById('animations-list');
const charNameInput = document.getElementById('char-name');

const UI = {
  activeCharName: document.getElementById('current-character-name'),
  activeAnimName: document.getElementById('current-animation-name')
};

// Ajustar tamaño del canvas
function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- Bucle de Renderizado ---
let lastFrameTime = 0;
const keysHeld = new Set();

function renderLoop(timestamp) {
  requestAnimationFrame(renderLoop);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!activeCharacter || !activeAnimState) return;

  const anim = activeAnimState.anim;
  if (!anim || !anim.frames || anim.frames.length === 0) return;

  // Actualizar frame
  if (timestamp - lastFrameTime > (1000 / anim.fps)) {
    lastFrameTime = timestamp;
    const currentFrame = anim.frames[activeAnimState.frameIndex];
    if (!currentFrame) {
      activeAnimState.frameIndex = 0;
      return;
    }

    activeAnimState.repeatCount++;

    if (activeAnimState.repeatCount >= (currentFrame.repeat || 1)) {
      activeAnimState.repeatCount = 0;
      activeAnimState.frameIndex++;

      if (activeAnimState.frameIndex >= anim.frames.length) {
        // Fin de la animación
        if (anim.repeatMode === 'loop') {
          activeAnimState.frameIndex = 0;
        } else if (anim.repeatMode === 'hold' && keysHeld.has(anim.shortcut.toLowerCase())) {
          activeAnimState.frameIndex = 0; // Repetir mientras se presiona
        } else if (anim.repeatMode === 'times' && activeAnimState.loopCount < anim.repeatTimes - 1) {
          activeAnimState.frameIndex = 0;
          activeAnimState.loopCount++;
        } else {
          // Ir a la siguiente animación si existe
          if (anim.nextAnim) {
            const nextAnimObj = activeCharacter.animations.find(a => a.id === anim.nextAnim);
            if (nextAnimObj) {
              playAnimation(nextAnimObj);
              return;
            }
          }
          // Si no hay siguiente y terminó, quedarse en el último frame o detener
          activeAnimState.frameIndex = anim.frames.length - 1; 
        }
      }
    }
  }

  // Dibujar
  const frame = anim.frames[activeAnimState.frameIndex];
  if (frame && frame.src) {
    const imgUrl = frame.src;

    if (!activeAnimState.imgCache[activeAnimState.frameIndex]) {
      const img = new Image();
      img.src = imgUrl;
      activeAnimState.imgCache[activeAnimState.frameIndex] = img;
    }
    const img = activeAnimState.imgCache[activeAnimState.frameIndex];
    if (img.complete) {
      // Centrar imagen
      const x = (canvas.width - img.width) / 2;
      const y = (canvas.height - img.height) / 2;
      ctx.drawImage(img, x, y);
    }
  }
}
requestAnimationFrame(renderLoop);

// --- Control de Teclado ---
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  
  const key = e.key.toLowerCase();
  if (!keysHeld.has(key)) {
    keysHeld.add(key);
    checkAndPlayAnimation(key);
  }
});

window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  keysHeld.delete(key);
});

function checkAndPlayAnimation(key) {
  if (!activeCharacter) return;
  const anim = activeCharacter.animations.find(a => a.shortcut.toLowerCase() === key);
  if (anim) {
    playAnimation(anim);
  }
}

function playAnimation(anim) {
  activeAnimState = {
    anim: anim,
    frameIndex: 0,
    loopCount: 0,
    repeatCount: 0,
    imgCache: {}
  };
  UI.activeAnimName.innerText = `Animación: ${anim.name} (FPS: ${anim.fps})`;
  lastFrameTime = performance.now();
}

// --- Gestión de Datos ---
async function loadCharacters() {
  characters = await db.characters.toArray();
  renderCharacterList();
}

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// --- UI de la Barra Lateral ---
function renderCharacterList() {
  characterListEl.innerHTML = '';
  characters.forEach(char => {
    const el = document.createElement('div');
    el.className = `character-item ${activeCharacter && activeCharacter.id === char.id ? 'active' : ''}`;
    el.innerHTML = `
      <span class="char-title">${char.name}</span>
      <div class="actions">
        <button class="btn btn-icon btn-edit" onclick="openEditModal(${char.id}, event)">✏️</button>
        <button class="btn btn-icon btn-delete" onclick="deleteCharacter(${char.id}, event)">🗑️</button>
      </div>
    `;
    el.onclick = () => selectCharacter(char);
    characterListEl.appendChild(el);
  });
}

function selectCharacter(char) {
  activeCharacter = char;
  activeAnimState = null;
  UI.activeCharName.innerText = char.name;
  UI.activeAnimName.innerText = char.animations.length > 0 
    ? "Presiona el atajo de una animación" 
    : "Este personaje no tiene animaciones aún";
  renderCharacterList();
}

async function deleteCharacter(id, e) {
  e.stopPropagation();
  if(confirm('¿Eliminar personaje?')) {
    await db.characters.delete(id);
    if (activeCharacter && activeCharacter.id === id) {
      activeCharacter = null;
      UI.activeCharName.innerText = 'Ningún personaje seleccionado';
      UI.activeAnimName.innerText = '';
    }
    loadCharacters();
  }
}

// --- Modal de Edición ---
document.getElementById('btn-add-character').onclick = () => {
  editingCharacter = {
    name: 'Nuevo Personaje',
    animations: []
  };
  openModal();
};

function openEditModal(id, e) {
  if (e) e.stopPropagation();
  editingCharacter = JSON.parse(JSON.stringify(characters.find(c => c.id === id)));
  // Convertir Blobs a URLs para previsualización (ya están guardados como blobs)
  // Nota: Dexie guarda Blobs, necesitamos URLs para el src
  openModal();
}

function openModal() {
  charNameInput.value = editingCharacter.name;
  renderAnimationsList();
  editModal.classList.remove('hidden');
}

document.getElementById('btn-close-modal').onclick = () => {
  editModal.classList.add('hidden');
  waitingAnimId = null;
};

// --- Animaciones UI ---
document.getElementById('btn-add-animation').onclick = () => {
  editingCharacter.animations.push({
    id: generateId(),
    name: 'Nueva Animación',
    shortcut: '',
    fps: 12,
    repeatMode: 'times',
    repeatTimes: 1,
    nextAnim: '',
    frames: [] // Aquí guardaremos object URLs temporalmente, al guardar convertiremos
  });
  renderAnimationsList();
};

function renderAnimationsList() {
  animationsListEl.innerHTML = '';
  editingCharacter.animations.forEach((anim, index) => {
    const el = document.createElement('div');
    el.className = 'animation-card';
    
    const nextAnimOptions = editingCharacter.animations
      .filter(a => a.id !== anim.id)
      .map(a => `<option value="${a.id}" ${anim.nextAnim === a.id ? 'selected' : ''}>${a.name}</option>`)
      .join('');

    el.innerHTML = `
      <div class="anim-header-row">
        <input type="text" class="input-modern anim-name-input" value="${anim.name}" placeholder="NOMBRE" onchange="updateAnim(${index}, 'name', this.value)">
        <input type="text" class="input-modern anim-shortcut-input" value="${anim.shortcut}" maxlength="1" placeholder="W" onkeyup="updateAnim(${index}, 'shortcut', this.value.toLowerCase())">
        <div class="anim-fps-container">
          <label>FPS:</label>
          <input type="number" class="input-modern anim-fps-input" value="${anim.fps}" onchange="updateAnim(${index}, 'fps', parseInt(this.value))" min="1" max="60">
        </div>
        <button class="btn btn-icon btn-delete" onclick="deleteAnim(${index})">🗑️</button>
      </div>

      <div class="frames-scroll-area">
        <div class="frames-grid" id="frames-${anim.id}" ondragover="allowDrop(event)" ondrop="dropFrame(event, '${anim.id}')">
          ${anim.frames.map((frame, fIndex) => `
            <div class="frame-item" draggable="true" ondragstart="dragFrame(event, '${anim.id}', ${fIndex})" ondragend="dragEnd(event)">
              <img src="${typeof frame === 'string' ? frame : frame.src}" class="frame-thumb">
              <div class="frame-controls">
                <input type="number" class="frame-repeat-input" value="${frame.repeat || 1}" onchange="updateFrameRepeat('${anim.id}', ${fIndex}, this.value)" min="1">
                <button class="btn-frame-delete" onclick="removeFrame('${anim.id}', ${fIndex})">×</button>
              </div>
            </div>
          `).join('')}
          <button class="btn-add-frames-inline" id="btn-insert-${anim.id}" onclick="handleInsertImages('${anim.id}')">
            +
          </button>
        </div>
      </div>

      <div class="anim-extra-settings">
        <div class="form-group">
          <label>Repetir Animación</label>
          <div style="display:flex; gap: 4px;">
            <select class="input-modern" style="flex:1" onchange="updateAnimMode(${index}, this.value)">
              <option value="times" ${anim.repeatMode === 'times' ? 'selected' : ''}>Veces</option>
              <option value="hold" ${anim.repeatMode === 'hold' ? 'selected' : ''}>Mantener</option>
              <option value="loop" ${anim.repeatMode === 'loop' ? 'selected' : ''}>Bucle infinito</option>
            </select>
            <input type="number" class="input-modern" style="width: 50px; display: ${anim.repeatMode === 'times' ? 'block' : 'none'}" value="${anim.repeatTimes}" onchange="updateAnim(${index}, 'repeatTimes', parseInt(this.value))" min="1">
          </div>
        </div>
        <div class="form-group">
          <label>Siguiente</label>
          <select class="input-modern" onchange="updateAnim(${index}, 'nextAnim', this.value)">
            <option value="">Ninguna</option>
            ${nextAnimOptions}
          </select>
        </div>
      </div>
    `;
    animationsListEl.appendChild(el);
  });
}

window.updateFrameRepeat = (animId, fIndex, val) => {
  const anim = editingCharacter.animations.find(a => a.id === animId);
  if (anim) {
    anim.frames[fIndex].repeat = parseInt(val) || 1;
  }
};

window.removeFrame = (animId, fIndex) => {
  const anim = editingCharacter.animations.find(a => a.id === animId);
  if (anim) {
    anim.frames.splice(fIndex, 1);
    renderAnimationsList();
  }
};

// Drag and Drop Logic
let draggedItem = null;
let draggedFromAnimId = null;
let draggedIndex = null;

window.dragFrame = (event, animId, index) => {
  draggedFromAnimId = animId;
  draggedIndex = index;
  event.target.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
};

window.dragEnd = (event) => {
  event.target.classList.remove('dragging');
};

window.allowDrop = (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
};

window.dropFrame = (event, toAnimId) => {
  event.preventDefault();
  if (draggedFromAnimId !== toAnimId) return;
  
  const anim = editingCharacter.animations.find(a => a.id === toAnimId);
  const target = event.target.closest('.frame-item');
  if (!target && event.target.classList.contains('frames-grid')) {
      // dropped on container, move to end
      const [item] = anim.frames.splice(draggedIndex, 1);
      anim.frames.push(item);
  } else if (target) {
      const targetIndex = Array.from(target.parentNode.children).indexOf(target);
      const [item] = anim.frames.splice(draggedIndex, 1);
      anim.frames.splice(targetIndex, 0, item);
  }
  renderAnimationsList();
};

window.updateAnim = (index, key, value) => {
  editingCharacter.animations[index][key] = value;
};

window.updateAnimMode = (index, value) => {
  editingCharacter.animations[index].repeatMode = value;
  renderAnimationsList();
};

window.deleteAnim = (index) => {
  editingCharacter.animations.splice(index, 1);
  renderAnimationsList();
};

// --- Lógica de Inserción de Imágenes ---
window.handleInsertImages = (animId) => {
  const btn = document.getElementById(`btn-insert-${animId}`);
  
  if (waitingAnimId === animId) {
    // Segundo clic: Abrir explorador de archivos
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*';
    input.onchange = (e) => {
      processFiles(e.target.files, animId);
      resetWaitingState();
    };
    input.click();
  } else {
    // Primer clic: Esperar CTRL+V
    resetWaitingState();
    waitingAnimId = animId;
    btn.classList.add('waiting');
    btn.innerText = 'Pegar con CTRL+V (o clic para buscar)';
  }
};

function resetWaitingState() {
  if (waitingAnimId) {
    const btn = document.getElementById(`btn-insert-${waitingAnimId}`);
    if (btn) {
      btn.classList.remove('waiting');
      btn.innerText = '+';
    }
    waitingAnimId = null;
  }
}

// Pegar desde portapapeles
window.addEventListener('paste', (e) => {
  if (!waitingAnimId) return;
  
  const files = [];
  if (e.clipboardData.items) {
    for (let i = 0; i < e.clipboardData.items.length; i++) {
      if (e.clipboardData.items[i].type.indexOf("image") !== -1) {
        files.push(e.clipboardData.items[i].getAsFile());
      }
    }
  }
  
  if (files.length > 0) {
    processFiles(files, waitingAnimId);
    resetWaitingState();
  }
});

async function processFiles(files, animId) {
  const anim = editingCharacter.animations.find(a => a.id === animId);
  if (!anim) return;

  for (let file of files) {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    await new Promise(r => {
      reader.onload = () => {
        anim.frames.push({
          src: reader.result,
          repeat: 1
        });
        r();
      };
    });
  }
  renderAnimationsList();
}

// --- Guardar Personaje ---
document.getElementById('btn-save-character').onclick = async () => {
  editingCharacter.name = charNameInput.value;
  
  if (editingCharacter.id) {
    await db.characters.put(editingCharacter);
  } else {
    await db.characters.add(editingCharacter);
  }
  
  editModal.classList.add('hidden');
  waitingAnimId = null;
  await loadCharacters();
  
  // Actualizar el activo si era el editado
  if (activeCharacter && activeCharacter.id === editingCharacter.id) {
    selectCharacter(characters.find(c => c.id === editingCharacter.id));
  }
};

// Iniciar
loadCharacters();
