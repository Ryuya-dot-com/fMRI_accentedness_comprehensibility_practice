"""Development only: copy approved practice WAVs and eight MRI practice forms."""
import ast
import hashlib
import json
from pathlib import Path
import shutil
import sys

site = Path(__file__).resolve().parents[1]
experiment = site.parent / 'Experiment'
sys.path.insert(0, str(experiment))
import accentedness as mri

cfg = dict(mri.load_config(experiment / 'config.json'), scale_max=5)
rows = mri.load_stimuli(experiment / 'stimuli.csv', cfg, active_phase='practice')
practice = sorted((r for r in rows if r['phase'] == 'practice'), key=lambda r:r['stimulus_id'])
assert len(practice) == 10 and all(r['placeholder'] == '0' for r in practice)
assert not {r['sentence_id'] for r in practice} & {r['sentence_id'] for r in rows if r['phase'] == 'main'}
site.joinpath('audio').mkdir(exist_ok=True)
files = {}
audio = []
for i, row in enumerate(practice, 1):
    name = f'audio/practice_{i:02}.wav'
    shutil.copyfile(row['audio_path'], site / name)
    digest = hashlib.sha256((site / name).read_bytes()).hexdigest()
    assert digest == row['audio_sha256']
    files[row['stimulus_id']] = name
    audio.append(dict(file=name, sha256=digest, duration_s=row['audio_duration_s'],
                      sentence_id=row['sentence_id'], pool=row['sentence_list'],
                      group=row['language_group']))

source = ast.parse((experiment / 'accentedness.py').read_text())
run = next(n for n in ast.walk(source) if isinstance(n, ast.FunctionDef) and n.name == 'run')
definition = next(n.value for n in ast.walk(run) if isinstance(n, ast.Assign)
                  and any(isinstance(t, ast.Name) and t.id == 'definition' for t in n.targets))
tasks = {name:dict(title=mri.LABELS[name][0], definition=eval(
    compile(ast.Expression(definition), '<MRI instruction>', 'eval'),
    dict(TASKS=mri.TASKS, plan=dict(task=name)))) for name in mri.TASKS}
forms = []
for participant in range(1, 9):
    plans = mri.build_runs(rows, cfg, str(participant), 'practice')
    forms.append([dict(task=p['task'], pool='P1+P2',
                       left=p['rating_left_label'], right=p['rating_right_label'],
                       trials=[dict(file=files[t['stimulus_id']],
                                    delay_s=t['rating_delay_s'], iti_s=t['jitter_s'])
                               for source in [p] + [other for other in plans if other is not p]
                               for t in source['trials']]) for p in plans])
payload = dict(version='joystick-practice-20261113', instruction_version=mri.INSTRUCTION_VERSION, scale_max=5,
               rating_s=cfg['rating_duration_s'], audio_gain=cfg['audio_volume'], initial_rest_s=cfg['initial_rest_s'],
               final_rest_s=cfg['final_rest_s'], deadzone=cfg['deadzone'],
               step_threshold=cfg['step_threshold'], tasks=tasks, audio=audio, forms=forms)
(site / 'practice.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2)+'\n')
print('Prepared 10 unchanged practice WAVs and 8 forms; no main sentences included.')
