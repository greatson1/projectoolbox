import Link from "next/link";
import { Button } from "@/components/ui/button";

interface ComingSoonProps {
  title: string;
  description: string;
  icon?: string;
}

export function ComingSoon({ title, description, icon = "🚀" }: ComingSoonProps) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-[480px] text-center">
        <div className="text-5xl mb-6">{icon}</div>
        <h1 className="text-3xl font-bold text-foreground mb-3">{title}</h1>
        <p className="text-base text-muted-foreground leading-relaxed mb-8">{description}</p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/">
            <Button variant="outline">Back to Home</Button>
          </Link>
          <Link href="/contact">
            <Button>Get Notified</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
