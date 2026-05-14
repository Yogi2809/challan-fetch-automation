import { useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

/**
 * handlers:
 *   onStatus, onProgress, onOtpRequired, onCaptchaRequired, onDone, onError
 *   _extraEvents?: Array<[eventName, handler]>   — for submit_started/done/error etc.
 */
export function useSocket(sessionId, handlers) {
  const socketRef = useRef(null);

  useEffect(() => {
    if (!sessionId) return;
    const socket = io({ path: '/socket.io', reconnection: true });
    socketRef.current = socket;

    function joinRoom() { socket.emit('join', { sessionId }); }

    socket.on('connect',   joinRoom);
    socket.on('reconnect', joinRoom);

    socket.on('status',           handlers.onStatus);
    socket.on('progress',         handlers.onProgress);
    socket.on('otp_required',     handlers.onOtpRequired);
    socket.on('captcha_required', handlers.onCaptchaRequired);
    socket.on('done',             handlers.onDone);
    socket.on('error',            handlers.onError);

    // Optional extra events (e.g. submit lifecycle)
    for (const [event, fn] of (handlers._extraEvents || [])) {
      socket.on(event, fn);
    }

    return () => socket.disconnect();
  }, [sessionId]);

  const send = useCallback((event, data) => {
    socketRef.current?.emit(event, data);
  }, []);

  return { send };
}
