import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WaterWise",
  description: "A browser-based watering planner for the BACISS demo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en-ZA"><body>{children}</body></html>;
}
