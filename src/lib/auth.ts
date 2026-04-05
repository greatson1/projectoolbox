import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { db } from "./db";
import bcrypt from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    signIn: "/login",
    newUser: "/onboarding",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET || "",
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await db.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        if (account?.provider === "google") {
          let dbUser = await db.user.findUnique({ where: { email: user.email! } });
          if (!dbUser) {
            dbUser = await db.user.create({
              data: {
                email: user.email!,
                name: user.name,
                image: user.image,
                emailVerified: new Date(),
              },
            });
          }
          token.sub = dbUser.id;
          token.role = dbUser.role;
          token.orgId = dbUser.orgId;
          token.onboardingComplete = dbUser.onboardingComplete;
        } else {
          const dbUser = await db.user.findUnique({
            where: { id: user.id },
            select: { role: true, orgId: true, onboardingComplete: true },
          });
          token.role = dbUser?.role;
          token.orgId = dbUser?.orgId;
          token.onboardingComplete = dbUser?.onboardingComplete;
        }
      }
      // Re-fetch orgId if it's missing from a stale token
      if (!token.orgId && token.sub) {
        const dbUser = await db.user.findUnique({
          where: { id: token.sub as string },
          select: { role: true, orgId: true, onboardingComplete: true },
        });
        if (dbUser?.orgId) {
          token.orgId = dbUser.orgId;
          token.role = dbUser.role;
          token.onboardingComplete = dbUser.onboardingComplete;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        (session.user as any).role = token.role;
        (session.user as any).orgId = token.orgId;
        (session.user as any).onboardingComplete = token.onboardingComplete;
      }
      return session;
    },
  },
});
