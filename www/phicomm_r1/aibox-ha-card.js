const PhicommBaseCard = customElements.get("phicomm-r1-card");

if (!PhicommBaseCard) {
  console.error("[AI BOX HA Card] Missing dependency: phicomm-r1-card must be loaded first.");
} else {
  class AiBoxHaCard extends PhicommBaseCard {
    static getStubConfig() {
      const base = typeof PhicommBaseCard.getStubConfig === "function"
        ? PhicommBaseCard.getStubConfig()
        : { entity: "media_player.phicomm_r1" };
      return { ...base, title: "AI BOX" };
    }

    setConfig(config) {
      const normalized = {
        title: "AI BOX",
        ...(config || {}),
      };

      // Alias nhẹ để người dùng cũ dễ migrate.
      if (!normalized.entity && normalized.device) {
        normalized.entity = normalized.device;
      }

      super.setConfig(normalized);
    }
  }

  if (!customElements.get("aibox-ha-card")) {
    customElements.define("aibox-ha-card", AiBoxHaCard);
  }

  window.customCards = window.customCards || [];
  if (!window.customCards.find((card) => card.type === "aibox-ha-card")) {
    window.customCards.push({
      type: "aibox-ha-card",
      name: "AI BOX HA Card",
      description: "AI BOX card chạy qua integration phicomm_r1 (HA proxy, không cần tunnel/domain).",
      preview: false,
    });
  }
}
