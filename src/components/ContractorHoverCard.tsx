import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Mail, Phone, CreditCard } from "lucide-react";
import type { ContractorInfo } from "@/types";

export function ContractorHoverCard({ contractor }: { contractor: ContractorInfo }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="text-foreground font-medium hover:text-accent transition-colors cursor-pointer text-[11px]">
          {contractor.name}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3 space-y-2" align="start">
        <p className="text-xs font-semibold">{contractor.name}</p>
        {contractor.email && (
          <a href={`mailto:${contractor.email}`} className="flex items-center gap-2 text-[11px] text-muted-foreground hover:text-accent transition-colors">
            <Mail className="h-3 w-3" /> {contractor.email}
          </a>
        )}
        {contractor.phone && (
          <a href={`tel:${contractor.phone}`} className="flex items-center gap-2 text-[11px] text-muted-foreground hover:text-accent transition-colors">
            <Phone className="h-3 w-3" /> {contractor.phone}
          </a>
        )}
        {contractor.license_number && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <CreditCard className="h-3 w-3" /> {contractor.license_number}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
