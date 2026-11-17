"""Development only: select approved practice WAVs using the supplied pre-ratings."""
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

# Speaker numbers and scores supplied by the user on 2026-11-17; no cutoffs or answer key.
preratings = {
    'KYO_F03_Greek_B2_020': (1, 14.29, 22.08),
    'TOH_M07_Azerbaijani_B1_051': (2, 72.46, 49.38),
    'KYO_M04_JP_B2_014': (3, 74.71, 83.92),
    'TOH_M03_Sundanese_B1_037': (4, 25.08, 34.83),
    'RIT_M03_JP_B1_093': (5, 92.88, 95.29),
    'TOH_F06_JP_B1_091': (6, 58.71, 66.29),
    'KYO_M15_Arabic_B1_015': (7, 71.75, 44.79),
    'OSA_F01_Sinhala_B1_079': (8, 69.75, 42.38),
    'TOH_F07_JP_B1_101': (9, 79.67, 81.63),
    'KYO_F03_Russian_B1_045': (10, 59.50, 31.92),
}
selection = {
    'comprehensibility': [1, 5, 6, 1, 3, 5, 4],
    'accentedness': [1, 5, 2, 5, 10, 1, 6],
}
cfg = dict(mri.load_config(experiment / 'config.json'), scale_max=5)
rows = mri.load_stimuli(experiment / 'stimuli.csv', cfg, active_phase='practice')
practice = sorted((r for r in rows if r['phase'] == 'practice'), key=lambda r:r['stimulus_id'])
assert len(practice) == 10 and all(r['placeholder'] == '0' for r in practice)
assert not {r['sentence_id'] for r in practice} & {r['sentence_id'] for r in rows if r['phase'] == 'main'}
site.joinpath('audio').mkdir(exist_ok=True)
files = {}
speakers = {}
audio = []
for i, row in enumerate(practice, 1):
    name = f'audio/practice_{i:02}.wav'
    if not (site / name).exists() or hashlib.sha256((site / name).read_bytes()).hexdigest() != row['audio_sha256']:
        shutil.copyfile(row['audio_path'], site / name)
    digest = hashlib.sha256((site / name).read_bytes()).hexdigest()
    assert digest == row['audio_sha256']
    files[row['stimulus_id']] = name
    speaker, comp, accent = preratings[row['stimulus_id'].removeprefix('PRACTICE_')]
    speakers[speaker] = row['stimulus_id']
    audio.append(dict(file=name, sha256=digest, duration_s=row['audio_duration_s'],
                      sentence_id=row['sentence_id'], pool=row['sentence_list'],
                      group=row['language_group'], speaker_number=speaker,
                      source_recording=Path(row['source_audio_file']).name,
                      prerating_comp=comp, prerating_accent=accent))

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
    timing = {t['stimulus_id']:t for p in plans for t in p['trials']}
    forms.append([dict(task=p['task'], pool='P1+P2',
                       left=p['rating_left_label'], right=p['rating_right_label'],
                       trials=[dict(file=files[t['stimulus_id']], role='explanation' if i < 2 else 'practice',
                                    delay_s=t['rating_delay_s'], iti_s=t['jitter_s'])
                               for i, speaker in enumerate(selection[p['task']])
                               for t in [timing[speakers[speaker]]]]) for p in plans])
payload = dict(version='joystick-practice-20261117', instruction_version=mri.INSTRUCTION_VERSION, scale_max=5,
               rating_s=cfg['rating_duration_s'], audio_gain=cfg['audio_volume'], initial_rest_s=cfg['initial_rest_s'],
               final_rest_s=cfg['final_rest_s'], deadzone=cfg['deadzone'],
               step_threshold=cfg['step_threshold'], tasks=tasks, audio=audio, forms=forms)
(site / 'practice.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2)+'\n')
print('Prepared 8 forms, each task 2 explanation + 5 solo trials; 10 approved WAVs retained, no main sentences included.')
