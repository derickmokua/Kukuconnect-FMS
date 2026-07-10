import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Order chicks · KukuConnect Kitui",
  description:
    "Order day-old and 3-week Kuroiler & Rainbow Rooster chicks. KukuConnect, Kitui. Pay via M-Pesa.",
  openGraph: {
    title: "Order chicks · KukuConnect",
    description:
      "Day-old & 3-week Kuroiler and Rainbow Rooster. Kitui hatchery.",
    type: "website",
  },
};

export default function OrderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
