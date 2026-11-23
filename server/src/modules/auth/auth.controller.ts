import type { RequestHandler } from 'express';
import type { OtpProvider } from '../../lib/otp';
import { requestOtp, verifyOtp } from './otp.service';

// Thin layer: read the (already validated) body, call the service, send the response.
export function createAuthController(deps: { otpProvider: OtpProvider }) {
  const requestOtpHandler: RequestHandler = async (req, res) => {
    res.json({ success: true, data: await requestOtp(req.body.phone, deps.otpProvider) });
  };

  const verifyOtpHandler: RequestHandler = async (req, res) => {
    res.json({ success: true, data: await verifyOtp(req.body.phone, req.body.code) });
  };

  return { requestOtp: requestOtpHandler, verifyOtp: verifyOtpHandler };
}
