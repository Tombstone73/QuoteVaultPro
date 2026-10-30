import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const directory = 'server/db/migrations_v2';

/** Compare protected identities before merging branches. This is not a database
 * readiness check and never modifies Git, SQL, a manifest or a migration ledger. */
export function migrationConflicts(dev, feature) {
  const conflicts = [];
  const frontier = dev.at(-1);
  for (const incoming of feature) {
    const existing = dev.filter(row => row.idx === incoming.idx || row.when === incoming.when || row.tag === incoming.tag);
    for (const deployed of existing) {
      if (deployed.idx !== incoming.idx || deployed.when !== incoming.when || deployed.tag !== incoming.tag || deployed.hash !== incoming.hash) {
        conflicts.push({ dev: deployed, feature: incoming });
      }
    }
    if (!existing.length && frontier && (incoming.idx <= frontier.idx || incoming.when <= frontier.when)) {
      conflicts.push({dev:frontier,feature:incoming});
    }
  }
  return conflicts;
}

function readHistory(ref) {
  // Structured argv; refs cannot become shell commands or git options.
  if (!/^[a-zA-Z0-9_./-]+$/.test(ref) || ref.startsWith('-')) throw new Error('Invalid Git reference');
  const read = name => execFileSync('git', ['show', `${ref}:${directory}/${name}`], {encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const tree = execFileSync('git',['ls-tree','-r',ref,'--',directory],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const blobs = new Map(tree.trim().split('\n').map(row=>{const [metadata,name]=row.split('\t');return [name,metadata.split(' ')[2]];}));
  return JSON.parse(read('meta/_journal.json')).entries.map(({idx,when,tag}) => {
    const hash=blobs.get(`${directory}/${tag}.sql`);
    if (!hash) throw new Error('Missing migration SQL');
    return {idx,when,tag,hash};
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [devRef='origin/dev',featureRef='HEAD'] = process.argv.slice(2);
    const conflicts = migrationConflicts(readHistory(devRef), readHistory(featureRef));
    console.log(JSON.stringify({devRef,featureRef,compatible:conflicts.length===0,conflicts},null,2));
    if (conflicts.length) {
      console.error('BLOCKED: reconcile migration identities before integration. Do not renumber applied history or refresh an anchor to conceal a collision.');
      process.exitCode=1;
    }
  } catch {
    console.error('Migration comparison failed; verify Git references and journal sources. No integration was attempted.');
    process.exitCode=1;
  }
}
