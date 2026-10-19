import { ModelExplorer } from "@/components/model/model-explorer";
import { listSellers, OLIST_META } from "@/lib/olist/sample";

export default function ModelPage() {
  return <ModelExplorer sellers={listSellers()} meta={OLIST_META} />;
}
