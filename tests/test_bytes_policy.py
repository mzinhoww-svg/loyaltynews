"""Regressao V21-16: politica de bytes, clone novo com core.autocrlf=true, UTF-8 e LF."""
import unittest, pathlib, sys, json, tempfile
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from test_governance import TestGov, BASE, Gov, Verifier, git, digest, canon, save, load

POLICY = (BASE / '.gitattributes').read_bytes()


class TestBytesPolicy(TestGov):
    def _baseline(self, with_policy):
        git(self.root, 'config', 'core.autocrlf', 'true')
        if with_policy:
            (self.root / '.gitattributes').write_bytes(POLICY)
            self.commit('bytes policy', 'root')
            self.trust['baseline_commit'] = self.head()
        self.gov = Gov(self.root, trust=self.trust)

    def _accept_r0_01(self, artifact_bytes):
        self.claim()
        (self.root / 'R0-01.log').write_bytes(artifact_bytes)
        self.commit('artifact')
        self.gov.call('gov_submit_evidence', self.args('R0-01', 'R0-01.log'))
        self.commit('evidence')
        self.attest()
        Verifier(self.root, self.trust).accept('R0-01')
        self.assertTrue(self.gov.accepted('R0-01'))

    def _clone(self):
        d = tempfile.TemporaryDirectory(); self.addCleanup(d.cleanup)
        dst = pathlib.Path(d.name) / 'clone'
        git(self.root, 'clone', '-q', '-c', 'core.autocrlf=true', str(self.root), str(dst))
        return dst

    def test_16_fresh_clone_autocrlf_policy(self):
        self._baseline(True)
        self._accept_r0_01('linha 1\r\nação → ok\r\n'.encode('utf-8'))  # CRLF e nao ASCII preservados
        dst = self._clone()
        for rel in ['governance/evidence/R0/R0-01.json', 'R0-01.log', '.gitattributes']:
            self.assertEqual((dst / rel).read_bytes(), git(dst, 'show', 'HEAD:' + rel).stdout, rel)
        self.assertTrue(Gov(dst, trust=self.trust).accepted('R0-01'))

    def test_17_negative_control_without_policy(self):
        self._baseline(False)
        self._accept_r0_01(b'linha 1\nlinha 2\n')
        dst = self._clone()
        ev = 'governance/evidence/R0/R0-01.json'
        self.assertNotEqual((dst / ev).read_bytes(), git(dst, 'show', 'HEAD:' + ev).stdout)
        self.assertFalse(Gov(dst, trust=self.trust).accepted('R0-01'))

    def test_18_utf8_lf_serialization(self):
        p = self.root / 'governance' / 'probe.json'
        save(p, {'texto': 'ação → ✓'})
        raw = p.read_bytes()
        self.assertNotIn(b'\r\n', raw)
        self.assertIn('ação → ✓'.encode('utf-8'), raw)
        self.assertEqual(load(p), {'texto': 'ação → ✓'})
        p.unlink(); save(p, {'texto': 'ação'}, exclusive=True)
        self.assertNotIn(b'\r\n', p.read_bytes()); self.assertIn('ação'.encode('utf-8'), p.read_bytes())

    def test_19_policy_protected(self):
        self.assertIn('.gitattributes', json.loads((BASE / 'governance' / 'policy.json').read_bytes())['protected'])


for _n in [n for n in dir(TestGov) if n.startswith('test_')]:
    setattr(TestBytesPolicy, _n, None)  # nao repetir os 15 testes herdados
del TestGov
if __name__ == '__main__':
    unittest.main(verbosity=2)
