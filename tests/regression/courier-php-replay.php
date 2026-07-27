<?php
declare(strict_types=1);
require_once '/home/ubuntu/qujianma-dk/includes/ai_client.php';

$fixtures=json_decode((string)file_get_contents(__DIR__.'/courier-layer-fixtures.json'),true,32,JSON_THROW_ON_ERROR);
$out=[];
foreach($fixtures as $fixture){
    $candidate=[
        'is_pickup_message'=>true,
        'matched_station_id'=>null,
        'station_name'=>'',
        'station_address'=>'',
        'pickup_codes'=>['R-2-'.substr((string)$fixture['source_id'],-2).'01'],
        'courier_name'=>$fixture['model_courier_name'],
        'pickup_time'=>'',
        'confidence'=>.9,
    ];
    $validated=validate_ai_pickup_result($candidate,$fixture['ocr_text'],[]);
    $actual=$validated['ok']?(string)($validated['data']['courier_name']??''):'<rejected>';
    $out[]=['source_id'=>$fixture['source_id'],'actual'=>$actual,'expected'=>$fixture['expected_courier_name'],'pass'=>$actual===$fixture['expected_courier_name']];
}
echo json_encode(['runtime'=>'php','cases'=>$out],JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT)."\n";
exit(count(array_filter($out,fn($x)=>!$x['pass']))?1:0);
