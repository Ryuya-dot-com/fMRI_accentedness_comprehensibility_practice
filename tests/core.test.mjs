import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {formIndex, calibration, normalizedAxis, StepRating} from '../core.mjs';

test('ID accepts positive arbitrary-size integers, preserves leading zeros and 8-cell assignment', () => {
  for (let i=1; i<=128; i++) assert.equal(formIndex(String(i).padStart(3,'0')), (i-1)%8);
  assert.equal(formIndex('9007199254740993'),0);
  for (const invalid of ['0','-1','1.5','1e3','','１２']) assert.throws(() => formIndex(invalid));
});
test('one tilt per neutral return; confirmation locks; preheld inputs and deadline do not answer', () => {
  const r = new StepRating(0,false);
  r.update(1,false,.1); assert.equal(r.value,4);
  r.update(1,false,.2); assert.equal(r.value,4);
  r.update(-1,false,.3); assert.equal(r.value,4);
  r.update(.16,false,.4); r.update(1,false,.5); assert.equal(r.value,4);
  r.update(.15,false,.6); r.update(.5,false,.7); assert.equal(r.value,5);
  r.update(0,false,.8); r.update(1,false,.9); assert.equal(r.value,5);
  r.update(0,false,1); r.update(-1,false,1.1); assert.equal(r.value,4);
  r.update(0,true,1.2); r.update(-1,false,1.3);
  assert.equal(r.value,4); assert.equal(r.confirmed,true);
  const held = new StepRating(1,true);
  held.update(1,true,.1); assert.equal(held.value,3); assert.equal(held.confirmed,false);
  held.update(0,true,.2); assert.equal(held.confirmed,false);
  held.update(0,false,.3); held.update(0,true,3); assert.equal(held.confirmed,false);
  const middle = new StepRating(0,false); middle.update(0,true,.1);
  assert.equal(middle.value,3); assert.equal(middle.confirmed,true);
});
test('physical left is screen left, either axis sign; calibration rejects incomplete or off-center signals', () => {
  for (const sign of [-1,1]) {
    const cal = calibration([-.03,0],[sign*.66,0],[-sign*.7,0]);
    assert.equal(cal.axis,0);
    assert.equal(normalizedAxis(cal.left,cal),-1);
    assert.equal(normalizedAxis(cal.right,cal),1);
    assert.ok(normalizedAxis(cal.center,cal) === 0);
  }
  for (const args of [[[0],[0],[1]], [[0],[.7],[.8]], [[.3],[-.7],[.8]], [[0],[NaN],[1]]]) {
    assert.throws(() => calibration(...args));
  }
});
test('eight forms contain each of the ten intact practice sounds once and have the correct task/pool/direction', () => {
  const d = JSON.parse(readFileSync(new URL('../practice.json', import.meta.url)));
  assert.equal(d.audio.length,10); assert.equal(d.forms.length,8);
  for (const item of d.audio) {
    const bytes = readFileSync(new URL('../'+item.file,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);
  }
  for (let i=0;i<8;i++) {
    const blocks = d.forms[i];
    assert.equal(blocks[0].task,i%2 === 0 ? 'comprehensibility':'accentedness');
    const comp = blocks.find(b=>b.task==='comprehensibility');
    assert.equal(comp.pool,Math.floor(i/2)%2 === 0 ? 'P1':'P2');
    assert.equal(comp.left,i<4 ? '理解しにくい':'理解しやすい');
    const accent = blocks.find(b=>b.task==='accentedness');
    assert.equal(accent.left,i<4 ? '訛りが強い':'訛りがない');
    assert.equal(accent.right,i<4 ? '訛りがない':'訛りが強い');
    const files = blocks.flatMap(b=>b.trials.map(t=>t.file));
    assert.equal(files.length,10); assert.equal(new Set(files).size,10);
    for (const b of blocks) {
      assert.equal(b.trials.length,5);
      assert.equal(d.audio.find(a=>a.file===b.trials[0].file).group,'japanese');
      b.trials.forEach(t=>{ assert.ok(t.delay_s>=0 && t.delay_s<=2.5); assert.ok(t.iti_s>=2 && t.iti_s<=6); });
    }
  }
});
