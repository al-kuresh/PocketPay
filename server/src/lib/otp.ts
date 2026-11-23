import { env } from '../config/env';
import { maskPhone } from '../utils/mask';

/** Sends a one-time code to a phone. Swap ConsoleOtpProvider for a real SMS gateway later. */
export interface OtpProvider {
  send(phone: string, code: string): Promise<void>;
}

/** No SMS yet: "sends" the OTP by printing it to the server log. */
export class ConsoleOtpProvider implements OtpProvider {
  async send(phone: string, code: string): Promise<void> {
    // Production logs are shipped and kept, so they must never contain a live code.
    console.info(
      env.NODE_ENV === 'production'
        ? `OTP sent to ${maskPhone(phone)}`
        : `OTP for ${maskPhone(phone)}: ${code}`,
    );
  }
}
