// Reads the photo id from whichever upload path ran.
//
// The URL upload is tried first. If Facebook cannot fetch the image itself
// (Pinterest hotlink protection, for example) the binary path downloads the
// bytes in n8n and uploads them as a file instead.
// Mode: Run Once for All Items.

const entry = $('Verify Claim').first().json;

const idFrom = (nodeName) => {
  try {
    const j = $(nodeName).first().json || {};
    // Graph returns { id } for an unpublished photo. With fullResponse the
    // payload sits under .body.
    const body = j.body && typeof j.body === 'object' ? j.body : j;
    return body && body.id ? String(body.id) : '';
  } catch {
    return ''; // node did not run
  }
};

const viaUrl = idFrom('FB Upload Photo By URL');
const viaBinary = idFrom('FB Upload Photo Binary');
const media_fbid = viaUrl || viaBinary;

if (!media_fbid) {
  return [{ json: { ...entry, media_fbid: '', upload_path: 'none',
    upload_error: 'Neither the URL upload nor the binary upload returned a '
      + 'photo id. See the two FB Upload nodes in this execution.' } }];
}

return [{ json: {
  ...entry,
  media_fbid,
  upload_path: viaUrl ? 'url' : 'binary',
  upload_error: '',
} }];
