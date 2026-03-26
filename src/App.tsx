/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import LiveAudioSession from './components/LiveAudioSession';

export default function App() {
  console.log('App component rendering');
  const status = document.getElementById('debug-status');
  if (status) status.innerText = 'App component rendering...';
  return (
    <div className="min-h-screen bg-neutral-950">
      <LiveAudioSession />
    </div>
  );
}
