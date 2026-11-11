"""Compare actual Python and JavaScript selection logic on independent traces."""
import json
from pathlib import Path
import random
import subprocess
import sys

site = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(site.parent / 'Experiment'))
import accentedness as mri

cfg = dict(mri.load_config(mri.ROOT / 'config.json'), scale_max=5)
rng = random.Random(11011)
cases = []
for _ in range(200):
    axis = rng.choice([-1, 0, 1])
    pressed = rng.choice([False, True])
    r = mri.Rating(neutral_seen=abs(axis)<=cfg['deadzone'], step_ready=abs(axis)<=cfg['deadzone'],
                   previous_button=4 if pressed else 0)
    steps = []
    for i in range(80):
        a = rng.choice([-1,-.5,-.4999,-.15,0,.15,.1501,.4999,.5,1])
        p = rng.choice([False, True])
        t = i * .05
        r.update(a, 4 if p else 0, t, cfg, onset=0, deadline=3)
        steps.append([a,p,t,[mri.scale_value(r.position,cfg),r.confirmed,r.neutral_seen,r.step_ready]])
    cases.append([axis,pressed,steps])
script = '''import {StepRating} from './core.mjs';
let input='';for await(const chunk of process.stdin) input+=chunk;
for(const [axis,pressed,steps] of JSON.parse(input)) {
 const r=new StepRating(axis,pressed);
 for(const [a,p,t,expected] of steps) {r.update(a,p,t);
  if(JSON.stringify([r.value,r.confirmed,r.neutralSeen,r.ready])!==JSON.stringify(expected)) throw Error('MRI mismatch');
 }
} console.log('PASS: 200 traces / 16,000 updates exactly match MRI Rating.update');'''
subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(cases),text=True,cwd=site,check=True)
