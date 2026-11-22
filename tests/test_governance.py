import unittest, tempfile, pathlib, os, subprocess, sys, json, csv, shutil
BASE=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(BASE/'verifier-kit'))
from gov import Gov,Denied,git,canon,digest,save,load,SCHEMAS,now
from verifier import Verifier,changed_protected
class TestGov(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.keys=tempfile.TemporaryDirectory();cls.old=os.environ.get('GNUPGHOME');os.environ['GNUPGHOME']=cls.keys.name;os.chmod(cls.keys.name,0o700)
  cls.fp={}
  for role in ['root','executor','reviewer','verifier']:
   uid=role+' <'+role+'@test.invalid>'
   subprocess.run(['gpg','--batch','--pinentry-mode','loopback','--passphrase','','--quick-generate-key',uid,'ed25519','sign','0'],check=True,capture_output=True)
   out=subprocess.check_output(['gpg','--batch','--with-colons','--list-keys',uid]).decode();cls.fp[role]=next(s.split(':')[9] for s in out.splitlines() if s.startswith('fpr:'))
 @classmethod
 def tearDownClass(cls):
  subprocess.run(['gpgconf','--kill','all'],capture_output=True)
  if cls.old is None:os.environ.pop('GNUPGHOME',None)
  else:os.environ['GNUPGHOME']=cls.old
  cls.keys.cleanup()
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name);g=self.root/'governance';g.mkdir();self.gdir=g
  self.testrows=[{'id':i,'gate':'R0','kind':kind,'dependencies':dep,'required_tests':[i+'-TEST'],'deferred':False,'responsavel':'Executor','achados_relacionados':find,'criterio_de_aceite':'fixture','teste':'fixture','evidencia':'fixture'} for i,kind,dep,find in [('R0-01','task',[],''),('R0-02','task',['R0-01'],''),('R0-03','task',[],'F-999'),('R0-12','gate',['R0-01','R0-02','R0-03'],'')]]
  save(g/'backlog.yaml',self.testrows);save(g/'requirements.yaml',[]);save(g/'decisions.yaml',[])
  (g/'findings.csv').write_text('id,severidade,status\nF-999,P0,fechado\n')
  self.ident={'status':'configured','root_fingerprint':self.fp['root'],'executor':{'fingerprint':self.fp['executor'],'provider':'deepseek'},'reviewer':{'fingerprint':self.fp['reviewer'],'provider':'anthropic'},'verifier':{'fingerprint':self.fp['verifier']}}
  save(g/'identities.yaml',self.ident);save(g/'policy.json',{'p0_remediation':{},'p0_bootstrap_allowed':[],'gate_tasks':{'R0':'R0-12'}})
  (self.root/'.mcp.json').write_text('{}');(self.root/'external-mirror').mkdir();(self.root/'external-mirror'/'verify.py').write_text('trusted')
  git(self.root,'init','-q');git(self.root,'config','user.name','Test');git(self.root,'config','user.email','test@test.invalid');git(self.root,'config','gpg.format','openpgp');git(self.root,'config','gpg.program','gpg')
  self.commit('baseline','root');self.trust={**self.ident,'baseline_commit':self.head(),'protected':['governance/backlog.yaml','governance/identities.yaml','governance/findings.csv','governance/policy.json','.mcp.json','external-mirror/'],'runner_policy_sha256':'a'*64};self.gov=Gov(self.root,trust=self.trust)
 def commit(self,msg,role='executor'):
  git(self.root,'add','-A');git(self.root,'commit','-q','-S'+self.fp[role],'-m',msg)
 def head(self):return git(self.root,'rev-parse','HEAD').stdout.decode().strip()
 def claim(self,i='R0-01',s='session'):
  return self.gov.call('gov_start_task',{'id':i,'sessao':s,'chave_idempotencia':'claim-'+s})
 def args(self,i='R0-01',p='test.log'):
  b=(self.root/p).read_bytes();h=digest(b);return {'tarefa':i,'artefatos':[p],'testes':[{'id':i+'-TEST','nome':'check','resultado':'passou','registro_sha256':h}],'chave_idempotencia':digest(canon([i,[{'caminho':p,'sha256':h,'bytes':len(b)}]]))}
 def submit(self,i='R0-01'):
  self.claim(i);p=i+'.log';(self.root/p).write_text('ok');self.commit('artifact');args=self.args(i,p);self.gov.call('gov_submit_evidence',args);self.commit('evidence');return args
 def tag(self,name,role,payload):
  git(self.root,'tag','-s','-u',self.fp[role],'-m',canon({**payload,'commit_sha':self.head()}).decode(),name,self.head())
 def attest(self,i='R0-01',failed=False,review_role='reviewer',provider='anthropic',ids=None):
  self.tag('review/'+i+'/'+self.head(),review_role,{'id':i,'decision':'favorable','executor_provider':'deepseek','reviewer_provider':provider,'executor_fingerprint':self.fp['executor'],'reviewer_fingerprint':self.fp[review_role]})
  ret=subprocess.run([sys.executable,'-c','raise SystemExit('+('1' if failed else '0')+')'],capture_output=True).returncode
  self.tag('checks/'+i+'/'+self.head(),'verifier',{'id':i,'clean_environment':True,'runner_policy_sha256':'a'*64,'tests':[{'id':k,'result':'pass' if ret==0 else 'fail'} for k in (ids or [i+'-TEST'])]})
 def err(self,code,fn,*a):
  with self.assertRaisesRegex(Denied,code):fn(*a)
 def test_01_missing_artifact(self):
  self.claim();self.err('EVIDENCE_INVALID',self.gov.call,'gov_submit_evidence',{'tarefa':'R0-01','artefatos':['missing'],'testes':[],'chave_idempotencia':'x'})
 def test_02_tamper(self):
  self.submit();(self.root/'R0-01.log').write_text('tampered');self.assertIn('HASH_MISMATCH',str(self.gov.report('R0')))
 def test_03_dependency(self):self.err('DEP_NOT_ACCEPTED',self.claim,'R0-02')
 def test_04_forged_acceptance(self):
  self.submit();save(self.gdir/'acceptance'/'R0.yaml',{'approved':True,'by':'executor'});self.commit('forged acceptance');raw=self.gov.evpath('R0-01').read_bytes();index={'R0-01':digest(raw)};self.tag('task/R0-01/accepted','executor',{'id':'R0-01','decision':'accepted','evidence_index':index,'index_sha256':digest(canon(index))});self.assertFalse(self.gov.accepted('R0-01'))
 def test_05_extra_argument(self):
  for n in SCHEMAS:self.err('NOT_ALLOWED',self.gov.call,n,{'approved':True})
 def test_06_concurrent_claim(self):self.claim();self.err('LOCKED_BY_OTHER',self.claim,'R0-01','other')
 def test_07_idempotent(self):
  a=self.submit();p=self.gov.evpath('R0-01');before=p.read_bytes();self.gov.call('gov_submit_evidence',a);self.assertEqual(p.read_bytes(),before);self.assertEqual(len(list(p.parent.glob('R0-01*.json'))),1)
 def test_08_protected(self):
  self.submit();data=load(self.gdir/'backlog.yaml');data[0]['criterio_de_aceite']='fake';save(self.gdir/'backlog.yaml',data);self.commit('attack');self.attest();v=Verifier(self.root,self.trust);self.err('PROTECTED_CHANGED',v.accept,'R0-01')
 def test_09_deterministic(self):self.assertEqual(canon(self.gov.report('R0')),canon(self.gov.report('R0')))
 def test_10_p0(self):
  (self.gdir/'findings.csv').write_text('id,severidade,status\nF-999,P0,aberto\n');self.assertNotIn('R0-03',[x['id'] for x in self.gov.call('gov_next_tasks',{})]);self.err('P0_OPEN',self.claim,'R0-03')
 def test_11_fail_test(self):
  self.submit();self.attest(failed=True);v=Verifier(self.root,self.trust);self.err('REQUIRED_TESTS_FAILED',v.accept,'R0-01');self.assertFalse(self.gov.accepted('R0-01'));self.assertTrue(self.gov.signed('task/R0-01/rejected/'+self.head(),'verifier'))
 def test_12_independent(self):
  self.submit();self.attest(review_role='executor',provider='deepseek');v=Verifier(self.root,self.trust);self.err('REVIEW_NOT_INDEPENDENT',v.accept,'R0-01')
 def test_13_verifier_protected(self):
  self.submit();(self.root/'external-mirror'/'verify.py').write_text('attack');self.commit('attack');self.attest();v=Verifier(self.root,self.trust);self.err('PROTECTED_CHANGED',v.accept,'R0-01')
 def test_14_positive(self):
  self.submit();self.attest();Verifier(self.root,self.trust).accept('R0-01');self.assertTrue(self.gov.accepted('R0-01'));self.assertIn('R0-02',[x['id'] for x in self.gov.call('gov_next_tasks',{})]);self.submit('R0-02');self.attest('R0-02');Verifier(self.root,self.trust).accept('R0-02');self.submit('R0-03');self.attest('R0-03');Verifier(self.root,self.trust).accept('R0-03');self.attest('R0-12',ids=[i+'-TEST' for i in ['R0-01','R0-02','R0-03','R0-12']]);Verifier(self.root,self.trust).accept('R0-12');self.assertTrue(self.gov.report('R0')['accepted'])
 def test_15_mcp(self):
  proc=subprocess.run([sys.executable,str(BASE/'tools'/'gov.py'),'--root',str(self.root),'mcp'],input='\n'.join(json.dumps(x) for x in [{'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-11-25'}},{'jsonrpc':'2.0','id':2,'method':'tools/list'},{'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'gov_get_state','arguments':{}}},{'jsonrpc':'2.0','id':4,'method':'tools/call','params':{'name':'gov_accept_gate','arguments':{'gate':'R0'}}}])+'\n',capture_output=True,text=True,check=True);res=[json.loads(l) for l in proc.stdout.splitlines()];self.assertEqual(len(res[1]['result']['tools']),13);self.assertTrue(res[3]['result']['isError']);self.assertIn('R0',res[2]['result']['content'][0]['text'])
if __name__=='__main__':unittest.main(verbosity=2)
