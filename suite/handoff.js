'use strict';
// Explicit handoff: uploads only when the user chooses Send to Cliproom.
window.RoomHandoff = {
  async send(blob, filename, duration, status, link) {
    status.textContent = 'Sending your media to the Cliproom server…';
    status.classList.remove('error');
    link.classList.add('hidden');
    try {
      const response = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Cliproom-Request': '1', 'X-File-Type': blob.type.split(';')[0], 'X-File-Name': encodeURIComponent(filename) },
        body: blob
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not send this file.');
      const query = new URLSearchParams({ asset: data.id, duration: String(duration) });
      link.href = '/cliproom/?' + query.toString();
      link.classList.remove('hidden');
      status.textContent = 'Ready in Cliproom. Open it to add this media to a new project.';
    } catch (error) { status.textContent = error.message; status.classList.add('error'); }
  }
};
