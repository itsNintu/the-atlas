"""Read loaded atlas-memory status through existing native command sessions; no generation."""
import asyncio, json
from pathlib import Path
from hermes_cli.gateway_client import connect_gateway
from hermes_cli.gateway_runtime import discover_gateway_endpoint
from hermes_constants import set_hermes_home_override, reset_hermes_home_override
ROOT = Path.home()/'AppData/Local/hermes'
OPS = Path('D:/Work/Operations/hermes/atlas-native')
OUT = Path('D:/Projects/TheAtlas/.engineering/adapter-loaded.json')

async def main():
    results = []
    for profile in ['default','builder','reaver','overwatch','wordsmith','orchestrator']:
        home = ROOT if profile == 'default' else ROOT/'profiles'/profile
        token = set_hermes_home_override(home)
        try:
            descriptor = discover_gateway_endpoint(home)
            prior = next(json.loads(path.read_text()) for path in OPS.glob('probe-*.json') if json.loads(path.read_text()).get('profile') == profile)
            async with connect_gateway(endpoint=descriptor.endpoint) as client:
                session = await client.rpc('session.resume', session_id=prior['session_id'], omit_messages=True)
                status = await client.rpc('command.dispatch', session_id=prior['session_id'], name='atlasnative', arg='', _timeout=30)
                loaded = json.loads(status['output'])
                results.append({'profile':profile,'session_running':session.get('running'),'version':loaded['version'],'attribution_version':loaded['attribution_version'],'source':loaded['source'],'outbox':loaded['outbox'],'owner_instance':descriptor.endpoint.instance_id,'owner_epoch':descriptor.endpoint.authority_epoch})
        finally:
            reset_hermes_home_override(token)
    OUT.write_text(json.dumps(results, indent=2)+'\n')
    print(json.dumps(results, indent=2))

asyncio.run(main())
