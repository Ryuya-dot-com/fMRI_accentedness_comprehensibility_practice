export function formIndex(id) {
  if (!/^[0-9]+$/.test(id) || BigInt(id) < 1n) throw new Error('参加者IDは1以上の整数で入力してください。');
  return Number((BigInt(id) - 1n) % 8n);
}

export function calibration(center, left, right) {
  if (!center.length || left.length !== center.length || right.length !== center.length ||
      ![...center, ...left, ...right].every(x => Number.isFinite(x) && Math.abs(x) <= 1)) {
    throw new Error('ジョイスティックの軸を読み取れません。接続を確認してください。');
  }
  const axis = center.reduce((best, value, i) =>
    Math.abs(left[i] - value) > Math.abs(left[best] - center[best]) ? i : best, 0);
  const c = center[axis], l = left[axis], r = right[axis];
  if (Math.abs(c) > .15) throw new Error('スティックが中央にありません。中央に戻して設定をやり直してください。');
  if (Math.abs(l-c) < .25 || Math.abs(r-c) < .25 || (l-c)*(r-c) >= 0) {
    throw new Error('左右の動きを確認できません。左端と右端へ倒して設定をやり直してください。');
  }
  return {axis, center:c, left:l, right:r};
}

export function normalizedAxis(raw, cal) {
  if (!Number.isFinite(raw)) throw new Error('ジョイスティックの軸を読み取れません。');
  const delta = raw - cal.center;
  const side = delta * (cal.right - cal.center) >= 0 ? cal.right : cal.left;
  return Math.max(-1, Math.min(1, delta / Math.abs(side - cal.center) * Math.sign(cal.right - cal.center)));
}

// Same neutral gate, thresholds, fresh-button gate and deadline as MRI Rating.update.
export class StepRating {
  constructor(axis, pressed, {deadzone=.15, step_threshold=.5, rating_s=3}={}) {
    this.value = 3;
    this.confirmed = false;
    this.neutralSeen = this.ready = Math.abs(axis) <= deadzone;
    this.previousPressed = pressed;
    this.deadzone = deadzone;
    this.threshold = step_threshold;
    this.duration = rating_s;
  }
  update(axis, pressed, elapsed) {
    if (Math.abs(axis) <= this.deadzone) this.neutralSeen = this.ready = true;
    const rising = pressed && !this.previousPressed;
    this.previousPressed = pressed;
    if (this.confirmed || !this.neutralSeen || elapsed >= this.duration) return;
    if (this.ready && Math.abs(axis) >= this.threshold) {
      this.value = Math.max(1, Math.min(5, this.value + Math.sign(axis)));
      this.ready = false;
    }
    if (rising) this.confirmed = true;
  }
}
