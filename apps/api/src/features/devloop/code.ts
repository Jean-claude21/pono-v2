/**
 * The hand that writes (D-027), pure: how an agent reads, searches, edits and runs in a project's
 * repository on its server. Shaped after the tools agents already know (Claude Code, the MCP
 * filesystem server, Desktop Commander): line-numbered reads by range, exact edits applied all or
 * nothing with a diff, content search apart from name search, every output bounded.
 */
import { q, workdir } from './domain.js';

/** Most a single answer carries back, so a conversation stays readable. */
export const LIMITS = {
  readLines: 2000,
  lineChars: 2000,
  files: 1000,
  matches: 300,
  diffChars: 30_000,
  writeChars: 400_000,
  outputChars: 20_000,
  seconds: 600,
} as const;

/**
 * A path inside the repository, as the agent gives it: relative, without `..`, never into `.git`,
 * `node_modules` or Pono's own folder. Answers the clean path, or null.
 */
export function safePath(path: string): string | null {
  const clean = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '');
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.includes('\0'))
    return null;
  const parts = clean.split('/').filter((p) => p && p !== '.');
  if (!parts.length || parts.includes('..')) return null;
  if (['.git', '.pono', 'node_modules'].includes(parts[0]!)) return null;
  return parts.join('/');
}

/**
 * The one script the server runs for every file operation: its input arrives base64-encoded in an
 * environment variable, never through the shell's quoting, and it answers one JSON line.
 */
const SCRIPT = String.raw`
const fs=require('fs'),p=require('path'),cp=require('child_process');
const I=JSON.parse(Buffer.from(process.env.PONO_IN,'base64').toString());
const L=I.limits;
const out=v=>{console.log(JSON.stringify(v));process.exit(0)};
const git=a=>cp.spawnSync('git',a,{encoding:'utf8',maxBuffer:64e6});
const inside=f=>{const r=p.resolve(f);return r.startsWith(process.cwd()+p.sep)};
for(const f of [I.path,I.to].filter(Boolean)) if(!inside(f)) out({error:'outside',path:f});
const files=()=>git(['ls-files','--cached','--others','--exclude-standard']).stdout.split('\n').filter(Boolean);
const glob=g=>{let r='';for(let i=0;i<g.length;i++){const c=g[i];
  if(c==='*'){if(g[i+1]==='*'){r+='.*';i++;if(g[i+1]==='/')i++}else r+='[^/]*'}
  else if(c==='?')r+='[^/]';else r+=c.replace(/[.+^$(){}|[\]\\]/g,'\\$&')}
  return new RegExp('^'+r+'$')};
const cut=(s,n)=>s.length>n?s.slice(0,n)+'\n…':s;
function finish(path,before,after,dry,action){
  const t=p.join('.pono','tmp');fs.mkdirSync(t,{recursive:true});
  fs.writeFileSync(p.join(t,'a'),before);fs.writeFileSync(p.join(t,'b'),after);
  const d=git(['diff','--no-index','--no-color','-U3',p.join(t,'a'),p.join(t,'b')]).stdout.split('\n').slice(4).join('\n');
  if(!dry){fs.mkdirSync(p.dirname(path),{recursive:true});fs.writeFileSync(path,after)}
  out({path,action:dry?'preview':action,diff:cut(d,L.diffChars)})}
switch(I.op){
case 'list':{let f=files();
  if(I.path)f=f.filter(x=>x===I.path||x.startsWith(I.path+'/'));
  if(I.pattern){const g=glob(I.pattern);f=f.filter(x=>g.test(x)||g.test(p.basename(x)))}
  out({total:f.length,files:f.slice(0,L.files),truncated:f.length>L.files})}
case 'read':{let b;try{b=fs.readFileSync(I.path)}catch{out({error:'not_found',path:I.path})}
  if(b.includes(0))out({path:I.path,binary:true,size:b.length});
  const all=b.toString('utf8').split('\n'),s=I.offset-1,part=all.slice(s,s+I.limit);
  const content=part.map((l,k)=>String(s+k+1).padStart(6)+'\t'+(l.length>L.lineChars?l.slice(0,L.lineChars)+'…':l)).join('\n');
  out({path:I.path,totalLines:all.length,from:s+1,to:s+part.length,content,truncated:s+part.length<all.length})}
case 'search':{const a=['grep','-n','-I','--untracked','-E'];if(I.ignoreCase)a.push('-i');a.push('-e',I.pattern);if(I.path)a.push('--',I.path);
  let m=git(a).stdout.split('\n').filter(Boolean);
  if(I.glob){const g=glob(I.glob);m=m.filter(l=>{const f=l.split(':')[0];return g.test(f)||g.test(p.basename(f))})}
  out({total:m.length,matches:m.slice(0,L.matches).map(l=>l.length>300?l.slice(0,300)+'…':l),truncated:m.length>L.matches})}
case 'edit':{let text;try{text=fs.readFileSync(I.path,'utf8')}catch{out({error:'not_found',path:I.path})}
  const before=text,crlf=text.includes('\r\n');
  for(const e of I.edits){
    const o=crlf&&!e.old.includes('\r')?e.old.replace(/\n/g,'\r\n'):e.old;
    const n=crlf&&!e.new.includes('\r')?e.new.replace(/\n/g,'\r\n'):e.new;
    const count=text.split(o).length-1;
    if(count===0){const first=(e.old.split('\n').find(l=>l.trim())||'').trim().slice(0,40);
      const near=first?text.split(/\r?\n/).map((l,k)=>[k+1,l]).filter(([,l])=>l.includes(first)).slice(0,3).map(([k,l])=>k+': '+l.slice(0,200)):[];
      out({error:'edit_not_found',path:I.path,old:e.old.slice(0,300),near,hint:'Read the file again: old_text must match exactly, spaces included.'})}
    if(count>1&&!e.all)out({error:'edit_ambiguous',path:I.path,old:e.old.slice(0,300),count,hint:'Give more surrounding lines, or set replace_all.'});
    text=e.all?text.split(o).join(n):text.replace(o,()=>n)}
  finish(I.path,before,text,I.dryRun,'edited')}
case 'write':{const had=fs.existsSync(I.path);finish(I.path,had?fs.readFileSync(I.path,'utf8'):'',I.content,false,had?'replaced':'created')}
case 'move':{if(!fs.existsSync(I.path))out({error:'not_found',path:I.path});if(fs.existsSync(I.to))out({error:'exists',path:I.to});
  fs.mkdirSync(p.dirname(I.to),{recursive:true});fs.renameSync(I.path,I.to);out({moved:I.path,to:I.to})}
case 'delete':{if(!fs.existsSync(I.path)||fs.statSync(I.path).isDirectory())out({error:'not_found',path:I.path});fs.rmSync(I.path);out({deleted:I.path})}
case 'changes':{const st=git(['status','--porcelain']).stdout.split('\n').filter(Boolean);
  const d=git(['diff','--no-color']).stdout;
  out({files:st,diff:cut(d,L.diffChars),truncated:d.length>L.diffChars})}
default:out({error:'unknown_op'})}
`;

export type CodeOp =
  | { op: 'list'; path: string | null; pattern: string | null }
  | { op: 'read'; path: string; offset: number; limit: number }
  | { op: 'search'; pattern: string; path: string | null; glob: string | null; ignoreCase: boolean }
  | {
      op: 'edit';
      path: string;
      edits: { old: string; new: string; all: boolean }[];
      dryRun: boolean;
    }
  | { op: 'write'; path: string; content: string }
  | { op: 'move'; path: string; to: string }
  | { op: 'delete'; path: string }
  | { op: 'changes' };

/** The command that runs one file operation in the repository on the server. */
export function codeCommand(repository: string, input: CodeOp): string {
  const data = Buffer.from(JSON.stringify({ ...input, limits: LIMITS })).toString('base64');
  return `cd "${workdir(repository)}" 2>/dev/null || { echo '{"error":"not_ready"}'; exit 0; }; PONO_IN=${q(data)} node -e ${q(SCRIPT)}`;
}

/** Reads the JSON line the script answered; a missing answer is the server's own failure. */
export function readCode(stdout: string): Record<string, unknown> {
  const line = stdout
    .trim()
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('{'));
  if (!line) return { error: 'no_answer' };
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { error: 'no_answer' };
  }
}

/**
 * A shell command in the repository, bounded in time (124 when it ran out), its output's end kept.
 * In the background, it answers a job id at once; its output is read later.
 */
export function runCommand(
  repository: string,
  command: string,
  seconds: number,
  background: boolean,
): string {
  const head = `cd "${workdir(repository)}" 2>/dev/null || { echo '<<<not_ready>>>'; exit 0; }; mkdir -p .pono/jobs`;
  if (background)
    return `${head}; J=$(date +%s%N); setsid nohup sh -c ${q(`timeout ${seconds} sh -c ${q(command)}; echo "<<<exit>>>$?"`)} > .pono/jobs/$J.log 2>&1 < /dev/null & echo "<<<job>>>$J"`;
  return `${head}; timeout ${seconds} sh -c ${q(command)} > .pono/run.log 2>&1; echo "<<<exit>>>$?"; tail -c ${LIMITS.outputChars} .pono/run.log`;
}

/** A background job's output so far, and its exit code once it ended. */
export function jobCommand(repository: string, job: string): string {
  return `cd "${workdir(repository)}" 2>/dev/null || { echo '<<<not_ready>>>'; exit 0; }; test -f .pono/jobs/${job}.log || { echo '<<<no_job>>>'; exit 0; }; tail -c ${LIMITS.outputChars} .pono/jobs/${job}.log`;
}

export interface RunResult {
  ready: boolean;
  job?: string;
  done: boolean;
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

/** Reads what `runCommand` or `jobCommand` printed. */
export function readRun(stdout: string): RunResult {
  if (stdout.includes('<<<not_ready>>>') || stdout.includes('<<<no_job>>>'))
    return { ready: false, done: true, exitCode: null, timedOut: false, output: '' };
  const job = /<<<job>>>(\d+)/.exec(stdout)?.[1];
  if (job) return { ready: true, job, done: false, exitCode: null, timedOut: false, output: '' };
  const m = /<<<exit>>>(\d+)\n?/.exec(stdout);
  const exitCode = m ? Number(m[1]) : null;
  const output = m ? `${stdout.slice(0, m.index)}${stdout.slice(m.index + m[0].length)}` : stdout;
  return {
    ready: true,
    done: m !== null,
    exitCode,
    timedOut: exitCode === 124,
    output: output.trimEnd(),
  };
}
