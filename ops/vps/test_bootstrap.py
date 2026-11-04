import io,json,tarfile,unittest,hashlib
import bootstrap

class PayloadTests(unittest.TestCase):
    def tar(self, pairs):
        b=io.BytesIO()
        with tarfile.open(fileobj=b,mode='w') as t:
            for name,content,kind in pairs:
                i=tarfile.TarInfo(name); i.type=kind; i.size=len(content)
                t.addfile(i,io.BytesIO(content))
        return b.getvalue()

    def test_rejects_links_traversal_duplicates_and_unlisted_files(self):
        for pairs in ([('../escape',b'x',tarfile.REGTYPE)],[('/abs',b'x',tarfile.REGTYPE)],
                      [('link',b'',tarfile.SYMTYPE)],[('x',b'a',tarfile.REGTYPE),('x',b'b',tarfile.REGTYPE)],
                      [('MANIFEST.json',b'{"revision":"' + b'a'*40 + b'","files":{}}',tarfile.REGTYPE),('extra',b'x',tarfile.REGTYPE)]):
            with self.subTest(pairs=pairs):
                with self.assertRaises(ValueError): bootstrap.unpack(self.tar(pairs))

    def test_rejects_corrupt_file_hash(self):
        names=['migrate.py','semapp-snow.service','runtime/node','runtime/app/dist/server.js']
        manifest={'revision':'a'*40,'files':{n:{'sha256':'0'*64,'mode':420} for n in names}}
        pairs=[('MANIFEST.json',json.dumps(manifest).encode(),tarfile.REGTYPE)]+[(n,b'x',tarfile.REGTYPE) for n in names]
        with self.assertRaises(ValueError): bootstrap.unpack(self.tar(pairs))

if __name__=='__main__': unittest.main()
