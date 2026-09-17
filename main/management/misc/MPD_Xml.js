module.exports = ({ mapName }) => {
    const getRandomInRange = (min, max) => {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    };
	 const bandwidth0 = getRandomInRange(490000, 600000);
    const bandwidth1 = getRandomInRange(1200000, 1700000);
    const bandwidth2 = getRandomInRange(2200000, 3200000); // Ajuste de ejemplo
    const bandwidth3 = getRandomInRange(2800000, 3800000); // Ajuste de ejemplo
	const indexRandom1 = getRandomInRange(596, 610);
	const indexFix=indexRandom1+1;

     return `<?xml version="1.0"?>
<MPD xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="urn:mpeg:DASH:schema:MPD:2011" xsi:schemaLocation="urn:mpeg:DASH:schema:MPD:2011" type="static" mediaPresentationDuration="PT30S" minBufferTime="PT1S" profiles="urn:webm:dash:profile:webm-on-demand:2012">
    <Period id="0" start="PT0S" duration="PT30S">
        <AdaptationSet id="0" mimeType="video/webm" codecs="vp8" lang="eng" maxWidth="720" maxHeight="370" subsegmentAlignment="true" subsegmentStartsWithSAP="1" bitstreamSwitching="true">
            <Representation id="0" bandwidth="${bandwidth0}">
                <BaseURL>jmcs://jd-contents/${mapName}/${mapName}_MapPreviewNoSoundCrop_LOW.vp8.webm</BaseURL>
                <SegmentBase indexRange="${indexRandom1}-1096">
                    <Initialization range="0-${indexRandom1}" />
                </SegmentBase>
            </Representation>
        </AdaptationSet>
    </Period>
</MPD>`;
};
