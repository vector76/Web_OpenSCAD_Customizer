
async function getBrowserFSLibrariesMounts(archiveNames) {
  const Buffer = BrowserFS.BFSRequire('buffer').Buffer;
  const fetchData = async url => (await fetch(url)).arrayBuffer();
  const results = await Promise.all(archiveNames.map(async n => [n, await fetchData(`./${n}.zip`)]));
  
  const zipMounts = {};
  for (const [n, zipData] of results) {
    zipMounts[n] = {
      fs: "ZipFS",
      options: {
        zipData: Buffer.from(zipData)
      }
    }
  }
  return zipMounts;
}

async function symlinkLibraries(archiveNames, FS, prefix='/libraries', cwd='/tmp') {
  const createSymlink = async (target, source) => {
    // console.log('symlink', target, source);
    await FS.symlink(target, source);
    // await symlink(target, source);
  };

  await Promise.all(archiveNames.map(n => (async () => {
    // removed generic symlink system and now only links named library archives
    await createSymlink(`${prefix}/${n}`, `${cwd}/${n}`);
  })()));
}
