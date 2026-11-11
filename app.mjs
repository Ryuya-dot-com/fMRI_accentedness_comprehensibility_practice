import {formIndex, calibration, normalizedAxis, StepRating} from './core.mjs';

const $ = id => document.getElementById(id);
const panels = ['welcome', 'message', 'listening', 'fixation', 'rating'];
const cells = [...document.querySelectorAll('#scale span')];
let phase = 'welcome', data, blocks, blockIndex = 0, trialIndex = 0;
let context, source, gain, buffers = new Map(), controller, cal, center, left;
let previousPressed = true, centerSince = null, rating, began = 0, deadline = 0;

function show(panel) {
  for (const id of panels) $(id).hidden = id !== panel;
}
function message(title, body, action='') {
  $('message-title').textContent = title;
  $('message-body').textContent = body;
  $('message-action').textContent = action;
  show('message');
}
function stop(text) {
  if (phase === 'error' || phase === 'finish') return;
  phase = 'error';
  if (source) { source.onended = null; source.stop(); source = null; }
  context?.suspend();
  rating = null;
  message('練習を停止しました', text);
  $('restart').hidden = false;
}
$('restart').onclick = () => location.reload();

async function loadAudio() {
  const response = await fetch('./practice.json');
  if (!response.ok) throw new Error('練習の設定を読み込めませんでした。');
  data = await response.json();
  await Promise.all(data.audio.map(async item => {
    const response = await fetch(item.file);
    if (!response.ok) throw new Error('音声を読み込めませんでした。通信を確認してやり直してください。');
    const bytes = await response.arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(b => b.toString(16).padStart(2,'0')).join('');
    if (digest !== item.sha256) throw new Error('音声ファイルが更新されています。ページを再読み込みしてください。');
    buffers.set(item.file, await context.decodeAudioData(bytes));
  }));
}
$('start-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (phase !== 'welcome') return;
  let index;
  try { index = formIndex($('participant').value.trim()); }
  catch (error) { $('start-error').textContent = error.message; return; }
  try {
    if (!window.isSecureContext || !navigator.getGamepads || !window.AudioContext) {
      throw new Error('Gamepad APIと音声再生に対応したPCブラウザーで、HTTPSのページを開いてください。');
    }
    phase = 'loading';
    $('start').disabled = true;
    context = new AudioContext();
    // A mouse/keyboard start gesture unlocks audio before gamepad-only operation.
    await context.resume();
    if (context.state !== 'running') throw new Error('音声再生を開始できませんでした。音声出力を確認してください。');
    context.onstatechange = () => {
      if (context.state !== 'running' && !['error','finish'].includes(phase)) stop('音声再生が停止しました。音声出力を確認してやり直してください。');
    };
    message('', '音声を準備しています。');
    await loadAudio();
    if (phase !== 'loading') return;
    gain = context.createGain();
    gain.gain.value = data.audio_gain;
    gain.connect(context.destination);
    blocks = data.forms[index];
    $('participant').value = '';
    phase = 'connect';
    message('ジョイスティックの確認', 'スティックを中央に戻してください。\n人差し指のボタンを1回押して、離してください。');
    requestAnimationFrame(frame);
  } catch (error) { stop(error.message); }
});

function padState() {
  const pad = navigator.getGamepads()[controller.index];
  if (!pad?.connected || pad.id !== controller.id || !pad.buttons[controller.button]) {
    throw new Error('ジョイスティックが切断されました。接続を確認して、やり直してください。');
  }
  if (cal && !Number.isFinite(pad.axes[cal.axis])) throw new Error('ジョイスティックの軸を読み取れません。');
  return {pad, pressed: pad.buttons[controller.button].pressed};
}
function instructions() {
  const block = blocks[blockIndex], task = data.tasks[block.task];
  phase = 'instructions';
  message(`練習：${task.title}の評価（${blockIndex+1} / 2）`,
    `${task.definition}\n\n音声が流れている間は操作せず、最後まで聞いてください。\n` +
    '音声の後は、評定画面が出るまでお待ちください。\n' +
    `評定画面が出てから${data.rating_s}秒以内に確定してください。\n` +
    '中央から左右に倒すたびに1段階動かし、人差し指のボタンで確定します。\n' +
    'スティックを中央に戻し、ボタンから指を離してください。\n' +
    `1：${block.left}　／　5：${block.right}\n` +
    '確定すると選んだマスが緑色になります。＋の間はお待ちください。',
    '人差し指のボタンで練習を始めます。');
}
function fixation(nextPhase, seconds, now, feedback='') {
  phase = nextPhase;
  deadline = now + seconds * 1000;
  $('feedback').textContent = feedback;
  show('fixation');
}
function listen() {
  if (context.state !== 'running') throw new Error('音声再生が停止しています。音声出力を確認してやり直してください。');
  phase = 'listening';
  show('listening');
  source = context.createBufferSource();
  source.buffer = buffers.get(blocks[blockIndex].trials[trialIndex].file);
  source.connect(gain);
  source.onended = () => {
    source = null;
    try { if (phase === 'listening') {
      const now = performance.now(), delay = blocks[blockIndex].trials[trialIndex].delay_s;
      // Zero delay has no extra fixation frame, matching the MRI task.
      if (delay === 0) beginRating(now); else fixation('delay', delay, now);
    } } catch (error) { stop(error.message); }
  };
  source.start();
}
function beginRating(now) {
  const {pad, pressed} = padState(), block = blocks[blockIndex];
  rating = new StepRating(normalizedAxis(pad.axes[cal.axis], cal), pressed, data);
  began = now;
  deadline = now + data.rating_s * 1000;
  phase = 'rating';
  $('task-title').textContent = data.tasks[block.task].title;
  $('left-label').textContent = block.left;
  $('right-label').textContent = block.right;
  drawRating();
  show('rating');
}
function drawRating() {
  for (const cell of cells) {
    const selected = Number(cell.dataset.value) === rating.value;
    cell.classList.toggle('selected', selected);
    cell.classList.toggle('confirmed', selected && rating.confirmed);
    cell.setAttribute('aria-label', `${cell.dataset.value}${selected ? rating.confirmed ? ' 確定' : ' 選択中' : ''}`);
  }
}
function frame(now) {
  if (phase === 'error' || phase === 'finish') return;
  try {
    if (phase === 'connect') {
      const active = [...navigator.getGamepads()].filter(p => p?.connected && p.buttons.some(b => b.pressed));
      if (active.length === 1) {
        const pad = active[0], pressed = pad.buttons.map((b,i) => b.pressed ? i : -1).filter(i => i >= 0);
        if (pressed.length === 1 && pad.axes.length) {
          controller = {index:pad.index, id:pad.id, button:pressed[0]};
          previousPressed = true;
          phase = 'center';
          message('ジョイスティックの確認', 'ボタンから指を離し、スティックを中央に戻してください。');
        }
      }
    } else {
      const {pad, pressed} = padState();
      const rising = pressed && !previousPressed;
      previousPressed = pressed;
      if (phase === 'center') {
        if (pressed) centerSince = null;
        else {
          if (centerSince === null || pad.axes.some((x,i) => Math.abs(x-center[i]) > .04)) {
            centerSince = now;
            center = [...pad.axes];
          }
          if (now-centerSince >= 500) {
            phase = 'left';
            message('左右の確認', 'スティックを左端へ倒し、\nそのまま人差し指のボタンを押してください。');
          }
        }
      } else if (phase === 'left' && rising) {
        left = [...pad.axes];
        // Validate a usable left movement now; final calibration also checks the right.
        const mirrored = center.map((x,i) => 2*x-left[i]);
        const preview = calibration(center, left, mirrored.map(x => Math.max(-1,Math.min(1,x))));
        cal = preview;
        phase = 'return-left';
        message('左右の確認', 'スティックを中央に戻し、ボタンから指を離してください。');
      } else if (phase === 'return-left' && !pressed && Math.abs(normalizedAxis(pad.axes[cal.axis], cal)) <= data.deadzone) {
        phase = 'right';
        message('左右の確認', 'スティックを右端へ倒し、\nそのまま人差し指のボタンを押してください。');
      } else if (phase === 'right' && rising) {
        cal = calibration(center, left, [...pad.axes]);
        phase = 'return-right';
        message('左右の確認', 'スティックを中央に戻し、ボタンから指を離してください。');
      } else if (phase === 'return-right' && !pressed && Math.abs(normalizedAxis(pad.axes[cal.axis], cal)) <= data.deadzone) {
        instructions();
      } else if (phase === 'instructions' && rising && Math.abs(normalizedAxis(pad.axes[cal.axis], cal)) <= data.deadzone) {
        fixation('initial', data.initial_rest_s, now);
      } else if (phase === 'initial' && now >= deadline) listen();
      else if (phase === 'delay' && now >= deadline) beginRating(now);
      else if (phase === 'rating') {
        if (now >= deadline) {
          const feedback = rating.confirmed ? '' : '時間内に確定できませんでした。';
          rating = null;
          fixation('iti', blocks[blockIndex].trials[trialIndex].iti_s, now, feedback);
        } else {
          rating.update(normalizedAxis(pad.axes[cal.axis], cal), pressed, (now-began)/1000);
          drawRating();
        }
      } else if (phase === 'iti' && now >= deadline) {
        trialIndex++;
        if (trialIndex < blocks[blockIndex].trials.length) listen();
        else fixation('final', data.final_rest_s, now);
      } else if (phase === 'final' && now >= deadline) {
        blockIndex++;
        trialIndex = 0;
        if (blockIndex < blocks.length) instructions();
        else {
          phase = 'finish';
          message('', '練習は終了しました。');
          $('restart').textContent = 'もう一度練習する';
          $('restart').hidden = false;
          context.suspend();
          buffers.clear();
        }
      }
    }
  } catch (error) { stop(error.message); }
  if (phase !== 'error' && phase !== 'finish') requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !['welcome','finish','error'].includes(phase)) stop('画面が切り替わりました。練習のページを開いたまま、やり直してください。');
});
window.addEventListener('blur', () => {
  if (!['welcome','finish','error'].includes(phase)) stop('別の画面へ移動しました。練習のページに戻って、やり直してください。');
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && phase !== 'welcome') stop('練習を中断しました。');
});
