import { observer } from "mobx-react";
import { X } from "lucide-react";
import { CYCLE_STATUS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/ui";
import { cn } from "@plane/utils";

type Props = {
  handleRemove: (val: string) => void;
  values: string[];
  editable: boolean | undefined;
};

export const AppliedStatusFilters: React.FC<Props> = observer((props) => {
  const { handleRemove, values, editable } = props;
  const { t } = useTranslation();

  return (
    <>
      {values.map((status) => {
        const statusDetails = CYCLE_STATUS.find((s) => s.value === status);
        return (
          <div
            key={status}
            className={cn(
              "flex items-center gap-1 rounded py-1 px-1.5 text-xs",
              statusDetails?.bgColor,
              statusDetails?.textColor
            )}
          >
            {statusDetails && t(statusDetails?.i18n_title)}
            {editable && (
              <Button
                unstyled
                type="button"
                className="grid place-items-center text-custom-text-300 hover:text-custom-text-200"
                onClick={() => handleRemove(status)}
              >
                <X size={10} strokeWidth={2} />
              </Button>
            )}
          </div>
        );
      })}
    </>
  );
});
