export function serializeAuthUser(user) {
  return {
    id: user.username,
    username: user.username,
    email: user.email || '',
    name: user.profile.displayName,
    role: user.profile.role,
    phone: user.profile.phone || '',
    department: user.profile.department || '',
    // Google linkage is public account information; the credential itself is never
    // returned or stored beyond the verified profile fields.
    authProviders: user.authProviders?.length ? [...user.authProviders] : ['password'],
    googleLinked: Boolean(user.googleSub),
    profileCompleted: user.profileCompleted !== false,
    picture: user.googlePictureUrl || '',
  };
}
