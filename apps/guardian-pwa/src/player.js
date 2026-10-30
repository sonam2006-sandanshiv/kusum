// Minimal WHEP (WebRTC-HTTP Egress Protocol) player for MediaMTX.
// Token goes in the query string; MediaMTX forwards it to the API's /media/auth hook.
export async function playWhep(video, path, getToken) {
  const pc = new RTCPeerConnection();
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.ontrack = (e) => {
    video.srcObject = e.streams[0];
    video.play().catch(() => {});
  };
  await pc.setLocalDescription(await pc.createOffer());
  const token = await getToken(path);
  const res = await fetch(`http://${location.hostname}:8889/${path}/whep?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: pc.localDescription.sdp,
  });
  if (!res.ok) throw new Error(`stream "${path}" unavailable (${res.status})`);
  await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
  return pc;
}
