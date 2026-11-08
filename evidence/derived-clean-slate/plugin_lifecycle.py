"""Supported six-profile atlas-memory disable/enable lifecycle with exact config custody."""
import datetime, hashlib, json, os, shutil, subprocess, sys
from pathlib import Path

HERMES = Path('C:/Users/alexb/AppData/Local/hermes')
PROFILES = ['default', 'builder', 'reaver', 'overwatch', 'wordsmith', 'orchestrator']
OUT = Path('D:/Projects/TheAtlas/.engineering')

def home(profile):
    return HERMES if profile == 'default' else HERMES / 'profiles' / profile

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def protected(h):
    return {relative: sha(h / relative) for relative in ['config.yaml', 'atlas/config.json', 'atlas/credential.json']}

def call(profile, action):
    command = ['hermes', '-p', profile, 'plugins', action, 'atlas-memory']
    if action == 'enable': command.append('--no-allow-tool-override')
    result = subprocess.run(command, capture_output=True, text=True, timeout=90)
    output = (result.stdout + result.stderr).strip()
    if result.returncode:
        raise RuntimeError(f'{action} failed for {profile}: {output[:1200]}')
    if 'running gateway reloaded' not in output.lower() and 'reloaded' not in output.lower():
        raise RuntimeError(f'{action} for {profile} did not confirm a running gateway reload: {output[:1200]}')
    return output

def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ['disable', 'enable']:
        raise SystemExit('usage: plugin_lifecycle.py disable|enable BACKUP_ROOT')
    action, root_text = sys.argv[1:]
    root = Path(root_text)
    records = {'mode': action, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'profiles': []}
    if action == 'disable':
        if root.exists():
            for profile in PROFILES:
                for relative in ['config.yaml', 'atlas/config.json', 'atlas/credential.json']:
                    if not (root / profile / relative).exists():
                        raise RuntimeError('existing custody is incomplete; reconcile instead of replaying')
        else:
            root.mkdir(parents=True)
            for profile in PROFILES:
                h = home(profile)
                target = root / profile
                target.mkdir()
                for relative in ['config.yaml', 'atlas/config.json', 'atlas/credential.json']:
                    destination = target / relative
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(h / relative, destination)
    for profile in PROFILES:
        h = home(profile)
        before = protected(h)
        output = call(profile, action)
        after = protected(h)
        records['profiles'].append({'profile': profile, 'before_sha256': before, 'after_sha256': after, 'output': output})
    if action == 'enable':
        original_root = root
        for record in records['profiles']:
            profile = record['profile']; h = home(profile)
            expected = record['before_sha256']
            # before_sha256 here is the disabled state; original enabled custody is on disk.
            for relative in ['config.yaml', 'atlas/config.json', 'atlas/credential.json']:
                source = original_root / profile / relative
                if sha(h / relative) != sha(source):
                    temporary = h / (relative + '.clean-slate-restore.tmp')
                    temporary.parent.mkdir(parents=True, exist_ok=True)
                    temporary.write_bytes(source.read_bytes())
                    os.replace(temporary, h / relative)
            # Reload even if enable happened to reproduce the exact original bytes.
            if protected(h) != {relative: sha(original_root / profile / relative) for relative in ['config.yaml', 'atlas/config.json', 'atlas/credential.json']}:
                call(profile, 'enable')
            record['restored_sha256'] = protected(h)
            record['original_config_restored'] = all(sha(h / relative) == sha(original_root / profile / relative) for relative in ['config.yaml', 'atlas/config.json', 'atlas/credential.json'])
            if not record['original_config_restored']:
                raise RuntimeError('configuration restoration failed for ' + profile)
    path = OUT / ('plugin-disable.json' if action == 'disable' else 'plugin-enable.json')
    path.write_text(json.dumps(records, indent=2) + '\n')
    print(json.dumps({'mode': action, 'receipt': str(path), 'profiles': [{'profile': p['profile'], 'output': p['output'], **({'original_config_restored': p['original_config_restored']} if action == 'enable' else {})} for p in records['profiles']]}, indent=2))

if __name__ == '__main__':
    main()
