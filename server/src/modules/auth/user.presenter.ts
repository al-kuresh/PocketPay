import type { KycSubmission, User } from '../../generated/prisma/client';
import type { StorageProvider } from '../../lib/storage';
import { maskNid } from '../../utils/mask';

/** The only shape of a user that leaves the server. No pinHash, no full NID, no date of birth. */
export interface PublicUser {
  id: string;
  phone: string;
  name: string;
  role: User['role'];
  status: User['status'];
  shopName: string | null;
  nidMasked: string;
  profilePhotoUrl: string | null;
  kycStatus: KycSubmission['status'] | null;
}

// An allowlist: every field is copied by name, so a new column can't leak by accident.
export function toPublicUser(
  user: User & { kycSubmissions: KycSubmission[] },
  storage: StorageProvider,
): PublicUser {
  const latest = user.kycSubmissions.reduce<KycSubmission | undefined>(
    (newest, s) => (!newest || s.submittedAt > newest.submittedAt ? s : newest),
    undefined,
  );
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role,
    status: user.status,
    shopName: user.shopName,
    nidMasked: maskNid(user.nidNumber),
    profilePhotoUrl: user.profilePhotoKey ? storage.publicUrl(user.profilePhotoKey) : null,
    kycStatus: latest?.status ?? null,
  };
}
