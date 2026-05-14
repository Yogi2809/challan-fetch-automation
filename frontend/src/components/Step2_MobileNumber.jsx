import React from 'react';

export default function Step2_MobileNumber({ sessionId, onSubmitted }) {
  // Mobile was collected in Step 1 and already sent with the job.
  // This step confirms the job is queued and waits for the browser to launch.
  React.useEffect(() => {
    // Auto-advance after a short delay to show the user the job is queued
    const t = setTimeout(onSubmitted, 1500);
    return () => clearTimeout(t);
  }, [onSubmitted]);

  return (
    <div className="text-center py-8">
      <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
      <p className="text-gray-600 text-sm font-medium">Job queued — launching browser…</p>
      <p className="text-gray-400 text-xs mt-1">Session: {sessionId}</p>
    </div>
  );
}
