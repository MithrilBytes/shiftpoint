import { formatMoney } from "@acme/shared";

export default function Home() {
  return <main>{formatMoney(1200)}</main>;
}
